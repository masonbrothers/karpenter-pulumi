# Third Party Notices

This package includes Kubernetes CustomResourceDefinition YAML copied from
`aws/karpenter-provider-aws` at `v1.12.1` and TypeScript bindings generated from
those CRDs with `crd2pulumi`.

Upstream project: https://github.com/aws/karpenter-provider-aws
Upstream license: Apache-2.0
License text: `THIRD_PARTY_LICENSES/APACHE-2.0.txt`

Bundled source files:

- `https://raw.githubusercontent.com/aws/karpenter-provider-aws/v1.12.1/pkg/apis/crds/karpenter.k8s.aws_ec2nodeclasses.yaml`
- `https://raw.githubusercontent.com/aws/karpenter-provider-aws/v1.12.1/pkg/apis/crds/karpenter.sh_nodeclaims.yaml`
- `https://raw.githubusercontent.com/aws/karpenter-provider-aws/v1.12.1/pkg/apis/crds/karpenter.sh_nodepools.yaml`

Changes made in this package:

- CRD YAML is copied into `crds/` with generated source/version headers.
- TypeScript Pulumi resources are generated from the CRD schemas.
- Generated TypeScript is normalized for provider tokens and trailing whitespace.

Upstream NOTICE:

Karpenter
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
