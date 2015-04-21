module.exports = {
  insert: {
    blocks: {
      row: 'INSERT INTO blocks ' +
           '    (height, hash, header, txids) ' +
           '  VALUES ' +
           '    ($1, $2, $3, $4)'
    },
    transactions: {
      confirmed: 'INSERT INTO transactions ' +
                 '    (txid, height, tx) ' +
                 '  VALUES ' +
                 '    ($1, $2, $3)'
    },
    history: {
      confirmedOutput: 'INSERT INTO history ' +
                       '    (address, otxid, oindex, ovalue, oscript, oheight) ' +
                       '  VALUES ' +
                       '    ($1, $2, $3, $4, $5, $6)'
    }
  },
  select: {
    blocks: {
      latest: 'SELECT ' +
              '    height as height, ' +
              '    hash as hash, ' +
              '    header as header ' +
              '  FROM blocks ' +
              '    ORDER BY height DESC ' +
              '    LIMIT 1'
    }
  },
  update: {
    history: {
      confirmedInput: 'UPDATE history ' +
                      '  SET ' +
                      '    itxid = $1, ' +
                      '    iheight = $2 ' +
                      '  WHERE ' +
                      '    otxid = $3 AND ' +
                      '    oindex = $4',

      deleteInputsFromHeight: 'UPDATE history ' +
                              '  SET ' +
                              '    itxid = NULL, ' +
                              '    iheight = NULL ' +
                              '  WHERE ' +
                              '    iheight > $1',

      deleteUnconfirmedInputs: 'UPDATE history ' +
                               '  SET ' +
                               '    itxid = NULL ' +
                               '  WHERE ' +
                               '    iheight IS NULL AND ' +
                               '    itxid IS NOT NULL'
    }
  },
  delete: {
    blocks: {
      fromHeight: 'DELETE FROM blocks ' +
                  '  WHERE ' +
                  '    height > $1'
    },
    transactions: {
      fromHeight: 'DELETE FROM transactions ' +
                  '  WHERE ' +
                  '    height > $1',

      unconfirmed: 'DELETE FROM transactions ' +
                   '  WHERE ' +
                   '    height IS NULL'
    },
    history: {
      fromHeight: 'DELETE FROM history ' +
                  '  WHERE ' +
                  '    oheight > $1',

      unconfirmed: 'DELETE FROM history ' +
                   '  WHERE ' +
                   '    oheight IS NULL'
    }
  }
}
