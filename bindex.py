#!/usr/bin/env python2
import bitcoin.core
import bitcoin.rpc
import psycopg2
import sets
import time
import traceback
import yaml

def rev_hex(s):
    return s.decode('hex')[::-1].encode('hex')

def int_to_hex(i, length=1):
    s = hex(i)[2:].rstrip('L')
    s = "0"*(2*length - len(s)) + s
    return rev_hex(s)

def header_to_string(block):
    return int_to_hex(block.nVersion, 4) \
        + rev_hex(block.hashPrevBlock.encode('hex')) \
        + rev_hex(block.hashMerkleRoot.encode('hex')) \
        + int_to_hex(block.nTime) \
        + int_to_hex(block.nBits, 4) \
        + int_to_hex(block.nNonce, 4)


class Indexer(object):
    version = '1'

    def __init__(self, config):
        self._initBitcoind(config)
        self._initPostgreSQL(config)
        self._loadBest()
        print 'Current best blockId: ' + self.bestBlockId
        self._mainLoop(config)

    def _getConn(self):
        return psycopg2.connect(self._pgConnString)

    def _initBitcoind(self, config):
        bitcoind_url = '{protocol}://{user}:{password}@{host}:{port}'.format(
            protocol='https' if config['bitcoind']['ssl'] else 'http',
            **config['bitcoind'])
        self._bitcoind = bitcoin.rpc.RawProxy(service_url=bitcoind_url)
        print 'Bitcoind info:', self._bitcoind.getinfo()

    def _initPostgreSQL(self, config):
        self._pgConnString = 'dbname={dbname} user={user} host={host} password={password}'.format(
            **config['postgresql'])

        with self._getConn() as conn:
            cur = conn.cursor()

            #
            cur.execute('DROP TABLE info,blocks,transactions,transactions_mempool,history,history_mempool')
            #
            cur.execute('select COUNT(*) from information_schema.tables where table_name=%s', ['info'])
            if cur.fetchone()[0] == 0:
                print 'Create tables...'
                cur.execute('CREATE TABLE info ('
                            '  key CHAR(255) PRIMARY KEY,'
                            '  value TEXT NOT NULL)')
                cur.execute('INSERT INTO info (key, value) VALUES (%s, %s)',
                    ['version', self.version])
                cur.execute('INSERT INTO info (key, value) VALUES (%s, %s)',
                    ['network', config['bindex']['network']])

                cur.execute('CREATE TABLE blocks ('
                            '  height INTEGER PRIMARY KEY,'
                            '  blockid CHAR(64) NOT NULL,'
                            '  header CHAR(160) NOT NULL)')
                cur.execute('CREATE INDEX ON blocks (blockid)')

                cur.execute('CREATE TABLE transactions ('
                            '  txid CHAR(64) PRIMARY KEY,'
                            '  height INTEGER NOT NULL,'
                            '  tx BYTEA NOT NULL)')
                cur.execute('CREATE INDEX ON transactions (height)')

                cur.execute('CREATE TABLE transactions_mempool ('
                            '  txid CHAR(64) PRIMARY KEY,'
                            '  tx BYTEA NOT NULL)')

                cur.execute('CREATE TABLE history ('
                            '  address CHAR(35) NOT NULL,'
                            '  txid CHAR(64) NOT NULL,'
                            '  height INTEGER NOT NULL)')
                cur.execute('CREATE INDEX ON history (address, height)')
                cur.execute('CREATE INDEX ON history (height)')

                cur.execute('CREATE TABLE history_mempool ('
                            '  address CHAR(35) NOT NULL,'
                            '  txid CHAR(64) NOT NULL)')
                cur.execute('CREATE INDEX ON history_mempool (address)')

            cur.execute('SELECT value FROM info WHERE key = %s', ['version'])
            if cur.fetchone()[0] != self.version:
                raise ValueError('Current Indexer have other version!')

            cur.execute('SELECT value FROM info WHERE key = %s', ['network'])
            if cur.fetchone()[0] != config['bindex']['network']:
                raise ValueError('Current config not matcher with db network!')

            conn.commit()

    def _loadBest(self):
        with self._getConn() as conn:
            cur = conn.cursor()

            cur.execute('SELECT height, blockid FROM blocks ORDER BY height DESC LIMIT 1')
            row = cur.fetchone()
            if row is None:
                row = [-1, '0' * 64]
            self.bestHeight = row[0]
            self.bestBlockId = row[1]

    def _mainLoop(self, config):
        while True:
            try:
                self._catchUp()
            except Exception, e:
                print traceback.format_exc()
            time.sleep(config['bindex']['loopInterval'])

    def _catchUp(self):
        truncateExecuted = False
        while True:
            info = self._bitcoind.getinfo()
            lastHeight = info['blocks']
            lastBlockId = self._bitcoind.getblockhash(lastHeight)
            with self._getConn() as conn:
                cur = conn.cursor()

                def storeTx(tx, tableName, height=None):
                    serializedTx = tx.serialize()
                    txid = bitcoin.core.b2lx(bitcoin.core.serialize.Hash(serializedTx))

                    params = [txid, height, serializedTx.encode('hex')]
                    if tableName == 'transactions':
                        sql = 'INSERT INTO transactions (txid, height, tx) VALUES (%s, %s, %s)'
                    else:
                        sql = 'INSERT INTO transactions_mempool (txid, tx) VALUES (%s, %s)'
                        params.pop(1)

                    cur.execute(sql, params)

                    # https://gist.github.com/dcousens/1d8c24d01e3f34bee453
                    for inp in tx.vin:
                        # PubKey     | canonicalSignature
                        # PubKeyHash | canonicalSignature canonicalPubKey
                        # ScriptHash | ?
                        # MultiSig   | OP_0 [canonicalSignature|OP_0]
                        pass
                    for outp in tx.vout:
                        # PubKey     | canonicalPubKey OP_CHECKSIG
                        # PubKeyHash | OP_DUP OP_HASH160 pubKeyHash OP_EQUALVERIFY OP_CHECKSIG
                        # ScriptHash | OP_HASH160 scriptHash OP_EQUAL
                        # MultiSig   | m canonicalPubKeys n OP_CHECKMULTISIG
                        opcodes = list(outp.scriptPubKey)

                if self.bestBlockId == lastBlockId:
                    print 'Update mempool'
                    txids = sets.Set(self._bitcoind.getrawmempool())
                    cur.execute('SELECT txid FROM transactions_mempool')
                    txids.difference_update([x[0] for x in cur.fetchall()])
                    for txid in txids:
                        txHex = self._bitcoind.getrawtransaction(txid)
                        tx = bitcoin.core.CTransaction.deserialize(bitcoin.core.x(txHex))
                        storeTx(tx, 'transactions_mempool')
                    conn.commit()
                    break

                if not truncateExecuted:
                    cur.execute('TRUNCATE transactions_mempool, history_mempool')
                    truncateExecuted = True

                if self.bestHeight >= lastHeight:
                    # remove rows if have reorg
                    print 'Remove rows from height ' + self.bestHeight

                    cur.execute('DELETE FROM blocks WHERE height >= %s', [self.bestHeight])
                    cur.execute('DELETE FROM transactions WHERE height >= %s', [self.bestHeight])
                    cur.execute('DELETE FROM history WHERE height >= %s', [self.bestHeight])
                else:
                    # or get block and import
                    blockHeight = self.bestHeight + 1
                    blockId = self._bitcoind.getblockhash(blockHeight)
                    print 'Import block ' + blockId

                    block_hex = self._bitcoind.getblock(blockId, False)
                    block = bitcoin.core.CBlock.deserialize(bitcoin.core.x(block_hex))
                    cur.execute('INSERT INTO blocks (height, blockid, header) VALUES (%s, %s, %s)',
                        [blockHeight, blockId, header_to_string(block.get_header())])

                    for tx in block.vtx:
                        storeTx(tx, 'transactions', blockHeight)

                conn.commit()

            self._loadBest()


if __name__ == '__main__':
    config = yaml.load(open('./config/bindex.yml', 'r'))
    indexer = Indexer(config)
