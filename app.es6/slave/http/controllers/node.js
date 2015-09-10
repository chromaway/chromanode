import { VERSION } from '../../../lib/const'

export function version (req, res) {
  res.jsend({version: VERSION})
}

export let v2 = {}
v2.status = (req, res) => {
  res.promise(req.master.getStatus())
}
