import cuid from "cuid"

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
  | "sys" // system
  | "api" // api
  | "tmpl" // template
  | "prod" // product
  | "psys" // product_system (join)
  | "cap" // capability
  | "rap" // release_artifact_pin (join)
  // org (reuses: team, prin, ptm, scope, idlk, agt, rpre, job, mem, tcred, tusg, msgp, sshk)
  | "cvar" // config_var
  // infra
  | "est" // estate
  | "rlm" // realm
  | "svc" // service
  | "nlnk" // network_link
  // ops
  | "tnt" // tenant
  | "sdp" // system_deployment
  | "dset" // deployment_set
  | "cdp" // component_deployment
  | "wbsnap" // workbench_snapshot
  | "db" // database (ops)
  | "dbop" // database_operation
  | "aprf" // anonymization_profile
  | "rout" // rollout
  | "intv" // intervention
  | "smfst" // site_manifest
  | "wbnch" // workbench
  // build (reuses: repo, prun, pstp, ghp, ghi, whe, grs, gus, wtp, wtpm, wi)
  | "wtpj" // work_tracker_project
  | "sver" // system_version
  | "cart" // component_artifact (join)
  // commerce (reuses: cust, pln, bndl)
  | "subi" // subscription_item
  | "bmet" // billable_metric
  | "csub" // subscription
  | "idk" // idempotency_key
  // software (continued)
  | "erel" // entity_relationship
  // workflow
  | "wfr" // workflow_run
  | "esub" // event_subscription
  | "esch" // event_subscription_channel
  | "evt" // event
  | "eob" // event_outbox
  | "edlv" // event_delivery
  | "eagg" // event_aggregate
  | "ealt" // event_alert
  // operations
  | "opr" // operation_run
  // interaction
  | "chan" // channel
  | "thrd" // thread
  | "turn" // thread_turn
  | "tprt" // thread_participant
  | "tc" // thread_channel (surface)
  | "msg" // message
  | "exch" // exchange
  | "doc" // document
  | "docv" // document_version
  | "sess" // session
  | "rxn" // reaction

export function newId(prefix: EntityPrefix): string {
  return `${prefix}_${cuid()}`
}
