# tflint for the cloud half of ADR 0083, run by CI beside `tofu validate`.
config {
  call_module_type = "none"
}

plugin "terraform" {
  enabled = true
  preset  = "all"
}

plugin "google" {
  enabled = true
  version = "0.38.0"
  source  = "github.com/terraform-linters/tflint-ruleset-google"
}

# The files are split by concern (network, cluster, sql, atlas), each named for
# what it declares; a `main.tf` would be an empty file kept for the rule.
rule "terraform_standard_module_structure" {
  enabled = false
}
