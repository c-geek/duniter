/**
 * Created by cgeek on 22/08/15.
 */

var Q = require('q');
var co = require('co');
var _ = require('underscore');
var AbstractSQLite = require('./AbstractSQLite');

module.exports = MembershipDAL;

function MembershipDAL(db) {

  "use strict";

  AbstractSQLite.call(this, db);

  let that = this;

  this.table = 'membership';
  this.fields = [
    'membership',
    'issuer',
    'number',
    'blockNumber',
    'blockHash',
    'userid',
    'certts',
    'block',
    'fpr',
    'idtyHash',
    'written',
    'signature'
  ];
  this.arrays = [];
  this.booleans = ['written'];
  this.pkFields = ['issuer','signature'];
  this.translated = {};

  this.init = () => co(function *() {
    return that.exec('BEGIN;' +
      'CREATE TABLE IF NOT EXISTS membership (' +
      'membership CHAR(2) NOT NULL,' +
      'issuer VARCHAR(50) NOT NULL,' +
      'number INTEGER NOT NULL,' +
      'blockNumber INTEGER,' +
      'blockHash VARCHAR(40) NOT NULL,' +
      'userid VARCHAR(255) NOT NULL,' +
      'certts DATETIME NOT NULL,' +
      'block INTEGER,' +
      'fpr VARCHAR(50),' +
      'idtyHash VARCHAR(40),' +
      'written BOOLEAN NOT NULL,' +
      'signature VARCHAR(50),' +
      'PRIMARY KEY (issuer,signature)' +
      ');' +
      'CREATE INDEX IF NOT EXISTS idx_mmembership_idtyHash ON membership (idtyHash);' +
      'CREATE INDEX IF NOT EXISTS idx_mmembership_membership ON membership (membership);' +
      'CREATE INDEX IF NOT EXISTS idx_mmembership_written ON membership (written);' +
      'COMMIT;', []);
  });

  this.getMembershipOfIssuer = (ms) => this.sqlExisting(ms);

  this.getMembershipsOfIssuer = (issuer) => this.sqlFind({
    issuer: issuer
  });

  this.getPendingINOfTarget = (hash) =>
    this.sqlFind({
      idtyHash: hash,
      membership: 'IN',
      written: false
  });

  this.getPendingIN = () => this.sqlFind({
    membership: 'IN',
    written: false
  });

  this.getPendingOUT = () => this.sqlFind({
    membership: 'OUT',
    written: false
  });

  this.unwriteMS = (ms) => co(function *() {
    let existing = yield that.sqlExisting({
      issuer: ms.issuer,
      signature: ms.signature
    });
    if (existing) {
      existing.written = false;
      that.saveEntity(existing);
    }
  });

  this.saveOfficialMS = (type, ms) => {
    let obj = _.extend({}, ms);
    obj.membership = type.toUpperCase();
    obj.written = true;
    return this.saveEntity(_.pick(obj, 'membership', 'issuer', 'number', 'blockNumber', 'blockHash', 'userid', 'certts', 'block', 'fpr', 'idtyHash', 'written', 'signature'));
  };

  this.savePendingMembership = (ms) => {
    ms.membership = ms.membership.toUpperCase();
    ms.written = false;
    return this.saveEntity(_.pick(ms, 'membership', 'issuer', 'number', 'blockNumber', 'blockHash', 'userid', 'certts', 'block', 'fpr', 'idtyHash', 'written', 'signature'));
  };

  this.updateBatchOfMemberships = (mss) => co(function *() {
    let queries = [];
    let insert = that.getInsertHead();
    let values = mss.map((cert) => that.getInsertValue(cert));
    if (mss.length) {
      queries.push(insert + '\n' + values.join(',\n') + ';');
    }
    if (queries.length) {
      return that.exec(queries.join('\n'));
    }
  });
}
