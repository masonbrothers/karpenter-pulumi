import type { EC2NodeClassArgs } from "./karpenter/v1/ec2nodeClass";
import type { NodePoolArgs } from "./karpenter/v1/nodePool";
import type { ObjectMeta } from "./meta/v1";
import type * as inputs from "./types/input";

export type KarpenterCapacityType = "spot" | "on-demand" | "reserved";
export type KarpenterArchitecture = "amd64" | "arm64";
export type KarpenterOperatingSystem = "linux" | "windows";

export type NodeClassRef =
  inputs.karpenter.v1.NodePoolSpecTemplateSpecNodeClassRef;
export type AmiSelectorTerm =
  inputs.karpenter.v1.EC2NodeClassSpecAmiSelectorTerms;
export type BlockDeviceMapping =
  inputs.karpenter.v1.EC2NodeClassSpecBlockDeviceMappings;
export type SecurityGroupSelectorTerm =
  inputs.karpenter.v1.EC2NodeClassSpecSecurityGroupSelectorTerms;
export type SubnetSelectorTerm =
  inputs.karpenter.v1.EC2NodeClassSpecSubnetSelectorTerms;
export type Ec2NodeClassSpec = inputs.karpenter.v1.EC2NodeClassSpec;
export type Requirement =
  inputs.karpenter.v1.NodePoolSpecTemplateSpecRequirements;
export type Taint = inputs.karpenter.v1.NodePoolSpecTemplateSpecTaints;
export type StartupTaint =
  inputs.karpenter.v1.NodePoolSpecTemplateSpecStartupTaints;
export type NodePoolSpec = inputs.karpenter.v1.NodePoolSpec;

export interface CreateEc2NodeClassManifestArgs {
  readonly name: string;
  readonly role: string;
  readonly clusterDiscoveryTag: string;
  readonly amiSelectorTerms?: AmiSelectorTerm[];
  readonly amiAlias?: string;
  readonly amiFamily?: string;
  readonly annotations?: Record<string, string>;
  readonly labels?: Record<string, string>;
  readonly blockDeviceMappings?: BlockDeviceMapping[];
  readonly securityGroupSelectorTerms?: SecurityGroupSelectorTerm[];
  readonly subnetSelectorTerms?: SubnetSelectorTerm[];
  readonly tags?: Record<string, string>;
  readonly userData?: string;
}

export interface CreateNodePoolManifestArgs {
  readonly name: string;
  readonly nodeClassName: string;
  readonly annotations?: Record<string, string>;
  readonly labels?: Record<string, string>;
  readonly capacityTypes?: KarpenterCapacityType[];
  readonly architectures?: KarpenterArchitecture[];
  readonly operatingSystems?: KarpenterOperatingSystem[];
  readonly requirements?: Requirement[];
  readonly expireAfter?: string;
  readonly consolidationPolicy?: string;
  readonly consolidateAfter?: string;
  readonly limits?: Record<string, string | number>;
  readonly taints?: Taint[];
  readonly startupTaints?: StartupTaint[];
  readonly templateAnnotations?: Record<string, string>;
  readonly templateLabels?: Record<string, string>;
  readonly terminationGracePeriod?: string;
  readonly weight?: number;
}

export const nodeClassRef = (name: string): NodeClassRef => ({
  group: "karpenter.k8s.aws",
  kind: "EC2NodeClass",
  name,
});

export const discoveryTagSelector = (
  clusterName: string,
): SecurityGroupSelectorTerm & SubnetSelectorTerm => ({
  tags: {
    "karpenter.sh/discovery": clusterName,
  },
});

export function createEc2NodeClassManifest(
  args: CreateEc2NodeClassManifestArgs,
): EC2NodeClassArgs {
  const amiSelectorTerms =
    args.amiSelectorTerms ?? (args.amiAlias ? [{ alias: args.amiAlias }] : []);

  if (amiSelectorTerms.length === 0) {
    throw new Error(
      "EC2NodeClass requires amiSelectorTerms or amiAlias. Pin an alias such as al2023@v20260209 for production.",
    );
  }

  return stripUndefined({
    apiVersion: "karpenter.k8s.aws/v1",
    kind: "EC2NodeClass",
    metadata: metadata(args.name, args),
    spec: stripUndefined({
      role: args.role,
      amiFamily: args.amiFamily,
      amiSelectorTerms,
      blockDeviceMappings: args.blockDeviceMappings,
      securityGroupSelectorTerms:
        args.securityGroupSelectorTerms ?? [
          discoveryTagSelector(args.clusterDiscoveryTag),
        ],
      subnetSelectorTerms:
        args.subnetSelectorTerms ?? [discoveryTagSelector(args.clusterDiscoveryTag)],
      tags: args.tags,
      userData: args.userData,
    }),
  }) satisfies EC2NodeClassArgs;
}

export function createNodePoolManifest(
  args: CreateNodePoolManifestArgs,
): NodePoolArgs {
  const requirements = mergeRequirements([
    requirement("kubernetes.io/arch", args.architectures ?? ["amd64"]),
    requirement("kubernetes.io/os", args.operatingSystems ?? ["linux"]),
    requirement("karpenter.sh/capacity-type", args.capacityTypes ?? ["spot"]),
    ...(args.requirements ?? []),
  ]);

  return stripUndefined({
    apiVersion: "karpenter.sh/v1",
    kind: "NodePool",
    metadata: metadata(args.name, args),
    spec: stripUndefined({
      template: stripUndefined({
        metadata:
          args.templateLabels || args.templateAnnotations
            ? stripUndefined({
                annotations: args.templateAnnotations,
                labels: args.templateLabels,
              })
            : undefined,
        spec: stripUndefined({
          nodeClassRef: nodeClassRef(args.nodeClassName),
          expireAfter: args.expireAfter ?? "720h",
          requirements,
          startupTaints: args.startupTaints,
          taints: args.taints,
          terminationGracePeriod: args.terminationGracePeriod,
        }),
      }),
      disruption: stripUndefined({
        consolidationPolicy:
          args.consolidationPolicy ?? "WhenEmptyOrUnderutilized",
        consolidateAfter: args.consolidateAfter ?? "60s",
      }),
      limits: args.limits,
      weight: args.weight,
    }),
  }) satisfies NodePoolArgs;
}

function metadata(
  name: string,
  args: {
    readonly annotations?: Record<string, string>;
    readonly labels?: Record<string, string>;
  },
): ObjectMeta {
  return stripUndefined({
    name,
    annotations: args.annotations,
    labels: args.labels,
  });
}

function requirement(key: string, values: string[]): Requirement {
  return {
    key,
    operator: "In",
    values: [...values],
  };
}

function mergeRequirements(requirements: Requirement[]): Requirement[] {
  const merged: Requirement[] = [];
  const indexesByKey = new Map<string, number>();

  for (const requirement of requirements) {
    const key = requirementKey(requirement);
    if (!key) {
      merged.push(requirement);
      continue;
    }

    const existingIndex = indexesByKey.get(key);
    if (existingIndex === undefined) {
      indexesByKey.set(key, merged.length);
      merged.push(requirement);
    } else {
      merged[existingIndex] = requirement;
    }
  }

  return merged;
}

function requirementKey(requirement: Requirement): string | undefined {
  const key = (requirement as { readonly key?: unknown }).key;
  return typeof key === "string" ? key : undefined;
}

function stripUndefined<T>(value: T): T {
  if (!value || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as T;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([key, entryValue]) => [key, stripUndefined(entryValue)]),
  ) as T;
}
