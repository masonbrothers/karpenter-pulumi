import {
  createEc2NodeClassManifest,
  createNodePoolManifest,
  nodeClassRef,
} from "../resources";
import {
  defaultControllerPolicyNames,
  defaultKarpenterVersion,
} from "../defaults";
import { describe, expect, it } from "vitest";

describe("Karpenter v1 manifests", () => {
  it("builds an EC2NodeClass with discovery selectors and a pinned AMI alias", () => {
    expect(
      createEc2NodeClassManifest({
        name: "default",
        role: "KarpenterNodeRole-prod",
        clusterDiscoveryTag: "prod",
        amiAlias: "al2023@v20260209",
        blockDeviceMappings: [
          {
            deviceName: "/dev/xvda",
            ebs: {
              encrypted: true,
              volumeSize: "80Gi",
              volumeType: "gp3",
            },
          },
        ],
      }),
    ).toEqual({
      apiVersion: "karpenter.k8s.aws/v1",
      kind: "EC2NodeClass",
      metadata: {
        name: "default",
      },
      spec: {
        role: "KarpenterNodeRole-prod",
        amiSelectorTerms: [{ alias: "al2023@v20260209" }],
        blockDeviceMappings: [
          {
            deviceName: "/dev/xvda",
            ebs: {
              encrypted: true,
              volumeSize: "80Gi",
              volumeType: "gp3",
            },
          },
        ],
        securityGroupSelectorTerms: [
          { tags: { "karpenter.sh/discovery": "prod" } },
        ],
        subnetSelectorTerms: [{ tags: { "karpenter.sh/discovery": "prod" } }],
      },
    });
  });

  it("refuses to create a NodeClass without an AMI selector", () => {
    expect(() =>
      createEc2NodeClassManifest({
        name: "default",
        role: "KarpenterNodeRole-prod",
        clusterDiscoveryTag: "prod",
      }),
    ).toThrow(/amiSelectorTerms or amiAlias/);
  });

  it("builds a default spot NodePool referencing the EC2NodeClass", () => {
    expect(
      createNodePoolManifest({
        name: "default",
        nodeClassName: "default",
        limits: {
          cpu: "400",
        },
      }),
    ).toMatchObject({
      apiVersion: "karpenter.sh/v1",
      kind: "NodePool",
      metadata: {
        name: "default",
      },
      spec: {
        limits: {
          cpu: "400",
        },
        disruption: {
          consolidateAfter: "60s",
          consolidationPolicy: "WhenEmptyOrUnderutilized",
        },
        template: {
          spec: {
            expireAfter: "720h",
            nodeClassRef: nodeClassRef("default"),
            requirements: [
              {
                key: "kubernetes.io/arch",
                operator: "In",
                values: ["amd64"],
              },
              {
                key: "kubernetes.io/os",
                operator: "In",
                values: ["linux"],
              },
              {
                key: "karpenter.sh/capacity-type",
                operator: "In",
                values: ["spot"],
              },
            ],
          },
        },
      },
    });
  });

  it("tracks current Karpenter defaults", () => {
    expect(defaultKarpenterVersion).toBe("1.12.1");
    expect(defaultControllerPolicyNames).toEqual([
      "KarpenterControllerNodeLifecyclePolicy",
      "KarpenterControllerIAMIntegrationPolicy",
      "KarpenterControllerEKSIntegrationPolicy",
      "KarpenterControllerInterruptionPolicy",
      "KarpenterControllerResourceDiscoveryPolicy",
      "KarpenterControllerZonalShiftPolicy",
    ]);
  });
});
