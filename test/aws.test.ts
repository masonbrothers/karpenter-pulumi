import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AwsKarpenter,
  buildKarpenterCosignVerifyCommand,
  cloudFormationTemplateUrl,
  verifyKarpenterChartSignature,
} from "../aws";

interface MockResource {
  readonly type: string;
  readonly name: string;
  readonly inputs: Record<string, unknown>;
}

const resources: MockResource[] = [];

pulumi.runtime.setMocks(
  {
    call: (args) => {
      if (args.token === "aws:index/getCallerIdentity:getCallerIdentity") {
        return {
          accountId: "123456789012",
          arn: "arn:aws:iam::123456789012:user/test",
          id: "123456789012",
          userId: "test",
        };
      }

      if (args.token === "aws:iam/getPolicyDocument:getPolicyDocument") {
        return {
          json: JSON.stringify(args.inputs),
        };
      }

      return args.inputs;
    },
    newResource: (args) => {
      const inputs = args.inputs ?? {};
      resources.push({
        inputs,
        name: args.name,
        type: args.type,
      });

      return {
        id: `${args.name}_id`,
        state: {
          ...inputs,
          arn: inputs.arn ?? `arn:mock:${args.type}:${args.name}`,
          name: inputs.name ?? args.name,
        },
      };
    },
  },
  "project",
  "stack",
  false,
);

describe("AwsKarpenter", () => {
  beforeEach(() => {
    resources.length = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds a stable CloudFormation template URL for the pinned release docs", () => {
    expect(cloudFormationTemplateUrl("1.12.1")).toBe(
      "https://raw.githubusercontent.com/aws/karpenter-provider-aws/v1.12.1/website/content/en/docs/getting-started/getting-started-with-karpenter/cloudformation.yaml",
    );
  });

  it("builds the documented cosign command for the Karpenter OCI chart", () => {
    expect(buildKarpenterCosignVerifyCommand("1.12.1", true)).toEqual({
      artifactRef: "public.ecr.aws/karpenter/karpenter:1.12.1",
      command: "cosign",
      args: [
        "verify",
        "public.ecr.aws/karpenter/karpenter:1.12.1",
        "--certificate-oidc-issuer=https://token.actions.githubusercontent.com",
        "--certificate-identity-regexp=https://github\\.com/aws/karpenter-provider-aws/\\.github/workflows/release\\.yaml@.+",
        "--certificate-github-workflow-repository=aws/karpenter-provider-aws",
        "--certificate-github-workflow-name=Release",
        "--certificate-github-workflow-ref=refs/tags/v1.12.1",
        "--annotations=version=1.12.1",
      ],
    });
  });

  it("allows the cosign command to be disabled or customized", () => {
    expect(
      buildKarpenterCosignVerifyCommand("1.12.1", { enabled: false }),
    ).toBeUndefined();
    expect(
      buildKarpenterCosignVerifyCommand("v1.12.1", {
        artifactRef: "registry.example.test/karpenter:1.12.1",
        certificateGitHubWorkflowRef: "refs/tags/custom",
        cosignPath: "/usr/local/bin/cosign",
        extraArgs: ["--certificate-github-workflow-sha=abc123"],
      }),
    ).toMatchObject({
      artifactRef: "registry.example.test/karpenter:1.12.1",
      command: "/usr/local/bin/cosign",
      args: expect.arrayContaining([
        "registry.example.test/karpenter:1.12.1",
        "--certificate-github-workflow-ref=refs/tags/custom",
        "--certificate-github-workflow-sha=abc123",
      ]),
    });
  });

  it("runs cosign only when chart signature verification is enabled", () => {
    const runCommand = vi.fn(() => ({ status: 0 }));

    verifyKarpenterChartSignature("1.12.1", undefined, runCommand);
    expect(runCommand).not.toHaveBeenCalled();

    verifyKarpenterChartSignature("1.12.1", true, runCommand);
    expect(runCommand).toHaveBeenCalledWith(
      "cosign",
      expect.arrayContaining([
        "verify",
        "public.ecr.aws/karpenter/karpenter:1.12.1",
      ]),
    );
  });

  it("fails clearly when cosign cannot verify the chart", () => {
    expect(() =>
      verifyKarpenterChartSignature("1.12.1", true, () => ({
        error: new Error("spawn cosign ENOENT"),
        status: null,
      })),
    ).toThrow(/Install cosign or disable verifyChartSignature/);

    expect(() =>
      verifyKarpenterChartSignature("1.12.1", true, () => ({ status: 1 })),
    ).toThrow(
      /cosign failed to verify Karpenter chart public\.ecr\.aws\/karpenter\/karpenter:1\.12\.1/,
    );
  });

  it("wires IAM, service account, Helm values, and node role outputs", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => "Resources: {}",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new k8s.Provider("cluster", {});
    const karpenter = new AwsKarpenter("karpenter", {
      cloudFormationTemplateUrl: "https://example.test/karpenter.yaml",
      clusterName: "prod",
      controllerPolicyNames: ["ControllerPolicy"],
      controllerResources: {
        limits: {
          cpu: "500m",
          memory: "768Mi",
        },
        requests: {
          cpu: "250m",
          memory: "512Mi",
        },
      },
      createAccessEntry: false,
      interruptionQueueName: "interruptions",
      k8sProvider: provider,
      nodeRoleName: "CustomNodeRole",
      oidcProvider: {
        arn: "arn:aws:iam::123456789012:oidc-provider/oidc.eks.test/id/abc",
        url: "oidc.eks.test/id/abc",
      },
      serviceAccountRoleName: "CustomControllerRole",
      settings: {
        featureGates: {
          nodeRepair: true,
        },
      },
    });

    await expect(outputValue(karpenter.nodeRoleArn)).resolves.toBe(
      "arn:aws:iam::123456789012:role/CustomNodeRole",
    );
    await Promise.all([
      outputValue(karpenter.controllerRole.arn),
      outputValue(karpenter.serviceAccount.urn),
      outputValue(karpenter.chart.urn),
    ]);

    expect(fetchMock).toHaveBeenCalledWith("https://example.test/karpenter.yaml");
    expect(findResource("aws:cloudformation/stack:Stack").inputs).toMatchObject({
      name: "Karpenter-prod",
      parameters: {
        ClusterName: "prod",
      },
    });
    expect(findResource("aws:iam/role:Role").inputs).toMatchObject({
      name: "CustomControllerRole",
      tags: {
        "karpenter.sh/discovery": "prod",
      },
    });
    expect(findResource("aws:iam/rolePolicyAttachment:RolePolicyAttachment").inputs).toMatchObject({
      policyArn: "arn:aws:iam::123456789012:policy/ControllerPolicy-prod",
    });
    expect(findResource("kubernetes:core/v1:ServiceAccount").inputs).toMatchObject({
      metadata: {
        annotations: {
          "eks.amazonaws.com/role-arn":
            "arn:mock:aws:iam/role:Role:karpenter-controller-role",
        },
        name: "karpenter",
        namespace: "kube-system",
      },
    });
    expect(findResource("kubernetes:helm.sh/v4:Chart").inputs).toMatchObject({
      chart: "oci://public.ecr.aws/karpenter/karpenter",
      namespace: "kube-system",
      values: {
        controller: {
          resources: {
            limits: {
              cpu: "500m",
              memory: "768Mi",
            },
            requests: {
              cpu: "250m",
              memory: "512Mi",
            },
          },
        },
        serviceAccount: {
          create: false,
          name: "karpenter",
        },
        settings: {
          clusterName: "prod",
          enableZonalShift: false,
          featureGates: {
            nodeRepair: true,
          },
          interruptionQueue: "interruptions",
        },
      },
      version: "1.12.1",
    });
    expect(
      resources.some((resource) => resource.type === "aws-native:eks:AccessEntry"),
    ).toBe(false);
  });
});

function findResource(type: string): MockResource {
  const resource = resources.find((candidate) => candidate.type === type);
  if (!resource) {
    throw new Error(
      `Expected mocked resource ${type}. Available: ${resources
        .map((candidate) => candidate.type)
        .join(", ")}`,
    );
  }
  return resource;
}

async function outputValue<T>(output: pulumi.Output<T>): Promise<T> {
  return (output as unknown as { promise: () => Promise<T> }).promise();
}
