import { spawnSync } from "node:child_process";

import * as aws from "@pulumi/aws";
import * as awsnative from "@pulumi/aws-native";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

import {
  createEc2NodeClassManifest,
  createNodePoolManifest,
  type CreateEc2NodeClassManifestArgs,
  type CreateNodePoolManifestArgs,
} from "./resources";
import {
  defaultControllerPolicyNames,
  defaultKarpenterNamespace,
  defaultKarpenterServiceAccountName,
  defaultKarpenterVersion,
} from "./defaults";
import * as karpenter from "./karpenter";

export {
  defaultControllerPolicyNames,
  defaultKarpenterNamespace,
  defaultKarpenterServiceAccountName,
  defaultKarpenterVersion,
} from "./defaults";

export interface EksOidcProvider {
  readonly url: pulumi.Input<string>;
  readonly arn: pulumi.Input<string>;
}

export interface AwsKarpenterArgs {
  readonly clusterName: string;
  readonly k8sProvider: k8s.Provider;
  readonly oidcProvider: pulumi.Input<EksOidcProvider>;
  readonly awsPartition?: string;
  readonly cloudFormationTemplateUrl?: string;
  readonly controllerPolicyNames?: readonly string[];
  readonly controllerResources?: ControllerResourceRequirements;
  readonly createAccessEntry?: boolean;
  readonly enableZonalShift?: boolean;
  readonly interruptionQueueName?: string;
  readonly karpenterVersion?: string;
  readonly namespace?: string;
  readonly nodeRoleName?: string;
  readonly serviceAccountName?: string;
  readonly serviceAccountRoleName?: string;
  readonly settings?: Record<string, unknown>;
  readonly verifyChartSignature?:
    | boolean
    | KarpenterChartSignatureVerificationArgs;
}

export interface ControllerResourceRequirements {
  readonly requests?: {
    readonly cpu?: string;
    readonly memory?: string;
  };
  readonly limits?: {
    readonly cpu?: string;
    readonly memory?: string;
  };
}

export interface KarpenterChartSignatureVerificationArgs {
  readonly enabled?: boolean;
  readonly cosignPath?: string;
  readonly artifactRef?: string;
  readonly certificateOidcIssuer?: string;
  readonly certificateIdentityRegExp?: string;
  readonly certificateGitHubWorkflowRepository?: string;
  readonly certificateGitHubWorkflowName?: string;
  readonly certificateGitHubWorkflowRef?: string;
  readonly annotations?: Record<string, string>;
  readonly extraArgs?: readonly string[];
}

export interface KarpenterCosignVerifyCommand {
  readonly command: string;
  readonly args: readonly string[];
  readonly artifactRef: string;
}

export interface CosignCommandResult {
  readonly status: number | null;
  readonly signal?: NodeJS.Signals | null;
  readonly error?: Error;
}

export type CosignCommandRunner = (
  command: string,
  args: readonly string[],
) => CosignCommandResult;

export class AwsKarpenter extends pulumi.ComponentResource {
  public readonly accessEntry?: awsnative.eks.AccessEntry;
  public readonly chart: k8s.helm.v4.Chart;
  public readonly cloudFormationStack: aws.cloudformation.Stack;
  public readonly controllerPolicyAttachments: aws.iam.RolePolicyAttachment[];
  public readonly controllerRole: aws.iam.Role;
  public readonly k8sProvider: k8s.Provider;
  public readonly namespace: string;
  public readonly namespaceResource: k8s.core.v1.Namespace;
  public readonly nodeRoleArn: pulumi.Output<string>;
  public readonly nodeRoleName: string;
  public readonly serviceAccount: k8s.core.v1.ServiceAccount;

  private readonly clusterName: string;

  constructor(
    name: string,
    args: AwsKarpenterArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super("karpenter-pulumi:aws:AwsKarpenter", name, {}, opts);

    const awsPartition = args.awsPartition ?? "aws";
    const karpenterVersion = args.karpenterVersion ?? defaultKarpenterVersion;
    const namespace = args.namespace ?? defaultKarpenterNamespace;
    const serviceAccountName =
      args.serviceAccountName ?? defaultKarpenterServiceAccountName;
    const serviceAccountRoleName =
      args.serviceAccountRoleName ?? `${args.clusterName}-${serviceAccountName}`;

    this.clusterName = args.clusterName;
    this.k8sProvider = args.k8sProvider;
    this.namespace = namespace;
    this.nodeRoleName = args.nodeRoleName ?? `KarpenterNodeRole-${args.clusterName}`;

    const accountId = pulumi
      .output(aws.getCallerIdentity({}, { parent: this }))
      .apply((identity) => identity.accountId);

    this.cloudFormationStack = new aws.cloudformation.Stack(
      `${name}-bootstrap`,
      {
        capabilities: ["CAPABILITY_NAMED_IAM"],
        name: `Karpenter-${args.clusterName}`,
        parameters: {
          ClusterName: args.clusterName,
        },
        templateBody: pulumi.output(
          fetchCloudFormationTemplate(
            karpenterVersion,
            args.cloudFormationTemplateUrl,
          ),
        ),
      },
      { parent: this },
    );

    this.controllerRole = new aws.iam.Role(
      `${name}-controller-role`,
      {
        assumeRolePolicy: pulumi.output(args.oidcProvider).apply((oidc) =>
          pulumi.all([oidc.url, oidc.arn]).apply(([url, arn]) =>
            aws.iam
              .getPolicyDocument({
                statements: [
                  {
                    actions: ["sts:AssumeRoleWithWebIdentity"],
                    conditions: [
                      {
                        test: "StringEquals",
                        values: [
                          `system:serviceaccount:${namespace}:${serviceAccountName}`,
                        ],
                        variable: `${url}:sub`,
                      },
                    ],
                    effect: "Allow",
                    principals: [
                      {
                        identifiers: [arn],
                        type: "Federated",
                      },
                    ],
                  },
                ],
              })
              .then((doc) => doc.json),
          ),
        ),
        name: serviceAccountRoleName,
        tags: {
          "karpenter.sh/discovery": args.clusterName,
        },
      },
      { dependsOn: [this.cloudFormationStack], parent: this },
    );

    this.controllerPolicyAttachments = (
      args.controllerPolicyNames ?? defaultControllerPolicyNames
    ).map(
      (policyName) =>
        new aws.iam.RolePolicyAttachment(
          `${name}-${policyName}`,
          {
            policyArn: pulumi.interpolate`arn:${awsPartition}:iam::${accountId}:policy/${policyName}-${args.clusterName}`,
            role: this.controllerRole.name,
          },
          {
            dependsOn: [this.cloudFormationStack, this.controllerRole],
            parent: this,
          },
        ),
    );

    this.namespaceResource = getSpecialOrCreateNamespace(
      `${name}-namespace`,
      namespace,
      {
        parent: this,
        provider: args.k8sProvider,
      },
    );

    this.serviceAccount = new k8s.core.v1.ServiceAccount(
      `${name}-service-account`,
      {
        metadata: {
          annotations: {
            "eks.amazonaws.com/role-arn": this.controllerRole.arn,
          },
          name: serviceAccountName,
          namespace,
        },
      },
      {
        dependsOn: [this.namespaceResource, this.controllerRole],
        parent: this,
        provider: args.k8sProvider,
      },
    );

    this.nodeRoleArn = pulumi.interpolate`arn:${awsPartition}:iam::${accountId}:role/${this.nodeRoleName}`;

    if (args.createAccessEntry ?? true) {
      this.accessEntry = new awsnative.eks.AccessEntry(
        `${name}-node-access-entry`,
        {
          clusterName: args.clusterName,
          principalArn: this.nodeRoleArn,
          type: "EC2_LINUX",
        },
        {
          dependsOn: [this.cloudFormationStack],
          parent: this,
        },
      );
    }

    verifyKarpenterChartSignature(
      karpenterVersion,
      args.verifyChartSignature,
    );

    this.chart = new k8s.helm.v4.Chart(
      `${name}-chart`,
      {
        chart: "oci://public.ecr.aws/karpenter/karpenter",
        namespace,
        values: {
          controller: {
            resources: controllerResources(args.controllerResources),
          },
          serviceAccount: {
            create: false,
            name: serviceAccountName,
          },
          settings: {
            clusterName: args.clusterName,
            interruptionQueue: args.interruptionQueueName ?? args.clusterName,
            enableZonalShift: args.enableZonalShift ?? false,
            ...(args.settings ?? {}),
          },
        },
        version: karpenterVersion,
      },
      {
        dependsOn: [
          this.cloudFormationStack,
          this.controllerRole,
          this.serviceAccount,
          this.namespaceResource,
          ...this.controllerPolicyAttachments,
          ...(this.accessEntry ? [this.accessEntry] : []),
        ],
        parent: this,
        provider: args.k8sProvider,
      },
    );

    this.registerOutputs({
      controllerRoleArn: this.controllerRole.arn,
      nodeRoleArn: this.nodeRoleArn,
      namespace: this.namespace,
    });
  }

  createEc2NodeClass(
    args: Omit<
      CreateEc2NodeClassManifestArgs,
      "role" | "clusterDiscoveryTag"
    > & {
      readonly role?: string;
      readonly clusterDiscoveryTag?: string;
    },
    opts?: pulumi.CustomResourceOptions,
  ): karpenter.v1.EC2NodeClass {
    return new karpenter.v1.EC2NodeClass(
      `${args.name}-ec2-node-class`,
      createEc2NodeClassManifest({
        ...args,
        role: args.role ?? this.nodeRoleName,
        clusterDiscoveryTag: args.clusterDiscoveryTag ?? this.clusterName,
      }),
      pulumi.mergeOptions(
        {
          dependsOn: [this.chart],
          parent: this,
          provider: this.k8sProvider,
        },
        opts,
      ),
    );
  }

  createNodePool(
    args: CreateNodePoolManifestArgs,
    opts?: pulumi.CustomResourceOptions,
  ): karpenter.v1.NodePool {
    return new karpenter.v1.NodePool(
      `${args.name}-node-pool`,
      createNodePoolManifest(args),
      pulumi.mergeOptions(
        {
          dependsOn: [this.chart],
          parent: this,
          provider: this.k8sProvider,
        },
        opts,
      ),
    );
  }
}

export function cloudFormationTemplateUrl(karpenterVersion: string): string {
  return `https://raw.githubusercontent.com/aws/karpenter-provider-aws/v${karpenterVersion}/website/content/en/docs/getting-started/getting-started-with-karpenter/cloudformation.yaml`;
}

export function buildKarpenterCosignVerifyCommand(
  karpenterVersion: string,
  verification: boolean | KarpenterChartSignatureVerificationArgs | undefined,
): KarpenterCosignVerifyCommand | undefined {
  if (!verification) {
    return undefined;
  }

  const options = verification === true ? {} : verification;
  if (options.enabled === false) {
    return undefined;
  }

  const version = stripLeadingV(karpenterVersion);
  const tag = `v${version}`;
  const annotations = {
    version,
    ...(options.annotations ?? {}),
  };
  const artifactRef =
    options.artifactRef ?? `public.ecr.aws/karpenter/karpenter:${version}`;
  const args = [
    "verify",
    artifactRef,
    `--certificate-oidc-issuer=${
      options.certificateOidcIssuer ??
      "https://token.actions.githubusercontent.com"
    }`,
    `--certificate-identity-regexp=${
      options.certificateIdentityRegExp ??
      "https://github\\.com/aws/karpenter-provider-aws/\\.github/workflows/release\\.yaml@.+"
    }`,
    `--certificate-github-workflow-repository=${
      options.certificateGitHubWorkflowRepository ??
      "aws/karpenter-provider-aws"
    }`,
    `--certificate-github-workflow-name=${
      options.certificateGitHubWorkflowName ?? "Release"
    }`,
    `--certificate-github-workflow-ref=${
      options.certificateGitHubWorkflowRef ?? `refs/tags/${tag}`
    }`,
    ...Object.entries(annotations).map(
      ([key, value]) => `--annotations=${key}=${value}`,
    ),
    ...(options.extraArgs ?? []),
  ];

  return {
    args,
    artifactRef,
    command: options.cosignPath ?? "cosign",
  };
}

export function verifyKarpenterChartSignature(
  karpenterVersion: string,
  verification: boolean | KarpenterChartSignatureVerificationArgs | undefined,
  runCommand: CosignCommandRunner = runCosignCommand,
): void {
  const verifyCommand = buildKarpenterCosignVerifyCommand(
    karpenterVersion,
    verification,
  );

  if (!verifyCommand) {
    return;
  }

  const result = runCommand(verifyCommand.command, verifyCommand.args);

  if (result.error) {
    throw new Error(
      `Cannot run cosign to verify Karpenter chart ${verifyCommand.artifactRef}: ${result.error.message}. Install cosign or disable verifyChartSignature.`,
    );
  }

  if (result.status !== 0) {
    const status =
      result.status === null
        ? `signal ${result.signal ?? "unknown"}`
        : `exit ${result.status}`;
    throw new Error(
      `cosign failed to verify Karpenter chart ${verifyCommand.artifactRef} (${status})`,
    );
  }
}

async function fetchCloudFormationTemplate(
  karpenterVersion: string,
  overrideUrl?: string,
): Promise<string> {
  const response = await fetch(
    overrideUrl ?? cloudFormationTemplateUrl(karpenterVersion),
  );

  if (!response.ok) {
    throw new Error(
      `Cannot download Karpenter CloudFormation template: ${response.status} ${response.statusText}`,
    );
  }

  const body = await response.text();
  if (!body.trim()) {
    throw new Error("Karpenter CloudFormation template response was empty");
  }
  return body;
}

function getSpecialOrCreateNamespace(
  name: string,
  namespaceName: string,
  opts?: pulumi.CustomResourceOptions,
): k8s.core.v1.Namespace {
  return ["default", "kube-system", "kube-public", "kube-node-lease"].includes(
    namespaceName,
  )
    ? k8s.core.v1.Namespace.get(name, namespaceName, opts)
    : new k8s.core.v1.Namespace(
        name,
        {
          metadata: {
            name: namespaceName,
          },
        },
        opts,
      );
}

function controllerResources(resources?: ControllerResourceRequirements) {
  return {
    limits: {
      cpu: resources?.limits?.cpu ?? "1",
      memory: resources?.limits?.memory ?? "1Gi",
    },
    requests: {
      cpu: resources?.requests?.cpu ?? "1",
      memory: resources?.requests?.memory ?? "1Gi",
    },
  };
}

function runCosignCommand(
  command: string,
  args: readonly string[],
): CosignCommandResult {
  return spawnSync(command, [...args], { stdio: "inherit" });
}

function stripLeadingV(version: string): string {
  return version.replace(/^v/, "");
}
