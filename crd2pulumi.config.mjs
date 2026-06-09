const version = "v1.12.1";
const baseUrl = `https://raw.githubusercontent.com/aws/karpenter-provider-aws/${version}/pkg/apis/crds`;

export default {
  cleanEntries: [
    "karpenter",
  ],
  downloadTimeoutMs: 30000,
  sources: [
    {
      name: "karpenter-ec2nodeclasses",
      sha256: "1b97c40c4d58c79d6be7079dab1e76ea24e7200e5d6987e6e2bd9c7dabd0fdc7",
      version,
      url: `${baseUrl}/karpenter.k8s.aws_ec2nodeclasses.yaml`,
    },
    {
      name: "karpenter-nodeclaims",
      sha256: "13e5c4966e9603e79ae60df961cc50673401c8f07f480e1391a425bff514ca26",
      version,
      url: `${baseUrl}/karpenter.sh_nodeclaims.yaml`,
    },
    {
      name: "karpenter-nodepools",
      sha256: "7a49d3e85bb467198aca5186d2886af5e434985c18eba431e722dc7d7de3a786",
      version,
      url: `${baseUrl}/karpenter.sh_nodepools.yaml`,
    },
  ],
};
