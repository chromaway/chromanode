import Storage from '../lib/storage'
import Messages from '../lib/messages'
import Sync from './sync'

/**
 * @return {Promise}
 */
export default async function () {
  let storage = new Storage()
  let messages = new Messages({storage: storage})
  await* [storage.ready, messages.ready]

  let sync = new Sync(storage, messages)
  await sync.run()
}
