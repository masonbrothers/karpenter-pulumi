const version = "v1.12.1";
const baseUrl = `https://raw.githubusercontent.com/aws/karpenter-provider-aws/${version}/pkg/apis/crds`;

export default {
  cleanEntries: [
    "karpenter",
  ],
  sources: [
    {
      name: "karpenter-ec2nodeclasses",
      version,
      url: `${baseUrl}/karpenter.k8s.aws_ec2nodeclasses.yaml`,
    },
    {
      name: "karpenter-nodeclaims",
      version,
      url: `${baseUrl}/karpenter.sh_nodeclaims.yaml`,
    },
    {
      name: "karpenter-nodepools",
      version,
      url: `${baseUrl}/karpenter.sh_nodepools.yaml`,
    },
  ],
};
