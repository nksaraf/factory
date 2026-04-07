import cuid from "cuid";

export type EntityPrefix =
  // ── Legacy prefixes (kept for backward compat) ───────────
  | "mod"
  | "cmp"
  | "wi"
  | "repo"
  | "mv"
  | "art"
  | "ca"
  | "agt"
  | "aex"
  | "cust"
  | "ent"
  | "pln"
  | "rel"
  | "dt"
  | "wl"
  | "ro"
  | "cls"
  | "site"
  | "vm"
  | "prv"
  | "rmp"
  | "wlo"
  | "int"
  | "dwo"
  | "cae"
  | "rgn"
  | "dc"
  | "host"
  | "kn"
  | "sub"
  | "ipa"
  | "vmc"
  | "mfst"
  | "sns"
  | "bndl"
  | "sbx"
  | "sbt"
  | "sba"
  | "rte"
  | "dom"
  | "tnl"
  | "imfst"
  | "rbnd"
  | "wtp"
  | "wtpm"
  | "ghp"
  | "ghi"
  | "whe"
  | "grs"
  | "gus"
  | "prev"
  | "team"
  | "prin"
  | "ptm"
  | "scope"
  | "cdom"
  | "csys"
  | "ccmp"
  | "cres"
  | "capi"
  | "elnk"
  | "idlk"
  | "tcred"
  | "tusg"
  | "msgp"
  | "chm"
  | "mthr"
  | "prun"
  | "pstp"
  | "rpre"
  | "job"
  | "mem"
  | "sshk"
  | "sec"
  | "fp"
  // ── Ontology prefixes (new schema) ───────────────────────
  // software
  | "sys"    // system
  | "api"    // api
  | "tmpl"   // template
  | "prod"   // product
  | "psys"   // product_system (join)
  | "cap"    // capability
  | "rap"    // release_artifact_pin (join)
  // org (reuses: team, prin, ptm, scope, idlk, agt, rpre, job, mem, tcred, tusg, msgp, sshk)
  | "cvar"   // config_var
  // infra
  | "subs"   // substrate
  | "rt"     // runtime
  | "nlnk"   // network_link
  // ops
  | "tnt"    // tenant
  | "sdp"    // system_deployment
  | "dset"   // deployment_set
  | "cdp"    // component_deployment
  | "wks"    // workspace
  | "wksn"   // workspace_snapshot
  | "db"     // database (ops)
  | "dbop"   // database_operation
  | "aprf"   // anonymization_profile
  | "rout"   // rollout
  | "intv"   // intervention
  | "smfst"  // site_manifest
  | "wbnch"  // workbench
  // build (reuses: repo, prun, pstp, ghp, ghi, whe, grs, gus, wtp, wtpm, wi)
  | "sver"   // system_version
  | "cart"   // component_artifact (join)
  // commerce (reuses: cust, pln, bndl)
  | "subi"   // subscription_item
  | "bmet"   // billable_metric
  | "csub"   // subscription
  // software (continued)
  | "erel"   // entity_relationship
  // workflow
  | "wfr"    // workflow_run
  | "esub"   // event_subscription
  // operations
  | "opr";   // operation_run

export function newId(prefix: EntityPrefix): string {
  return `${prefix}_${cuid()}`;
}
