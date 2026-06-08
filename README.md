# karpenter-pulumi

Pulumi TypeScript bindings and helpers for installing Karpenter on AWS EKS and
creating Karpenter v1 `EC2NodeClass` / `NodePool` resources.

This package exposes generated `crd2pulumi` bindings for the Karpenter CRDs and
adds small helpers for the common AWS EKS launch path.

## Install

```sh
npm install karpenter-pulumi @pulumi/aws @pulumi/aws-native @pulumi/kubernetes @pulumi/pulumi
```

## Example

```ts
import * as eks from "@pulumi/eks";
import * as k8s from "@pulumi/kubernetes";
import { AwsKarpenter } from "karpenter-pulumi/aws";

const clusterName = "prod-eks";

const cluster = new eks.Cluster("cluster", {
  createOidcProvider: true,
  authenticationMode: "API_AND_CONFIG_MAP",
  tags: {
    "karpenter.sh/discovery": clusterName,
  },
});

const provider = new k8s.Provider("cluster", {
  kubeconfig: cluster.kubeconfigJson,
});

const karpenter = new AwsKarpenter("karpenter", {
  clusterName,
  k8sProvider: provider,
  oidcProvider: cluster.core.oidcProvider,
});

karpenter.createEc2NodeClass({
  name: "default",
  amiAlias: "al2023@v20260209",
});

karpenter.createNodePool({
  name: "default",
  nodeClassName: "default",
  capacityTypes: ["spot", "on-demand"],
});
```

## Generated CRDs

The root package exports generated CRD modules:

```ts
import { karpenter, types } from "karpenter-pulumi";

new karpenter.v1.NodePool("default", {
  metadata: { name: "default" },
  spec: {
    template: {
      spec: {
        nodeClassRef: {
          group: "karpenter.k8s.aws",
          kind: "EC2NodeClass",
          name: "default",
        },
        requirements: [],
      },
    },
  },
});

const spec: types.input.karpenter.v1.NodePoolSpecArgs = {
  template: {
    spec: {
      nodeClassRef: {
        group: "karpenter.k8s.aws",
        kind: "EC2NodeClass",
        name: "default",
      },
      requirements: [],
    },
  },
};
```

## Generate

```sh
pnpm generate:crds
```

The CRDs currently come from `aws/karpenter-provider-aws` tag `v1.12.1`.

For local regeneration, clone `masonbrothers/crd2pulumi-package-tools` as a
sibling directory:

```sh
git clone git@github.com:masonbrothers/crd2pulumi-package-tools.git ../crd2pulumi-package-tools
```

## Publish

GitHub Actions runs install, CRD regeneration, typecheck, build, and tests.
Publishing runs from GitHub Releases with npm provenance and requires an
`NPM_TOKEN` repository secret.
