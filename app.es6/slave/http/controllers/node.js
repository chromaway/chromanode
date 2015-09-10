import { VERSION } from '../../../lib/const'

let v2 = {}
v2.status = (req, res) => {
  res.promise(req.master.getStatus())
}

export default {
  version: (req, res) => {
    res.jsend({version: VERSION})
  },
  v2
}
