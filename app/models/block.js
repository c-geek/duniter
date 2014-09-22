var mongoose  = require('mongoose');
var async     = require('async');
var sha1      = require('sha1');
var _         = require('underscore');
var fs        = require('fs');
var Schema    = mongoose.Schema;
var base64    = require('../lib/base64');
var logger    = require('../lib/logger')('dao keyblock');

var BlockSchema = new Schema({
  version: String,
  currency: String,
  nonce: {"type": Number, "default": 0},
  number: {"type": Number, "default": 0},
  timestamp: {"type": Number, "default": 0},
  previousHash: String,
  previousIssuer: String,
  membersCount: {"type": Number, "default": 0},
  identities: Array,
  joiners: Array,
  leavers: Array,
  excluded: Array,
  certifications: Array,
  transactions: Array,
  signature: String,
  hash: String,
  issuer: String,
  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now }
});

BlockSchema.pre('save', function (next) {
  this.updated = Date.now();
  next();
});

BlockSchema.methods = {
  
  json: function() {
    var that = this;
    var json = {};
    [
      "version",
      "nonce",
      "number",
      "timestamp",
      "membersCount",
    ].forEach(function(field){
      json[field] = parseInt(that[field], 10);
    });
    [
      "currency",
      "issuer",
      "signature",
      "hash",
    ].forEach(function(field){
      json[field] = that[field] || "";
    });
    [
      "previousHash",
      "previousIssuer",
    ].forEach(function(field){
      json[field] = that[field] || null;
    });
    [
      "dividend",
      "fees",
    ].forEach(function(field){
      json[field] = parseInt(that[field]) || null;
    });
    [
      "membersChanges",
    ].forEach(function(field){
      json[field] = that[field] || [];
    });
    [
      "identities",
      "joiners",
      "leavers",
      "excluded",
      "certifications",
    ].forEach(function(field){
      json[field] = [];
      that[field].forEach(function(raw){
        json[field].push(raw);
      });
    });
    [
      "transactions",
    ].forEach(function(field){
      json[field] = [];
      that[field].forEach(function(obj){
        json[field].push(_(obj).omit('raw', 'certifiers', 'hash'));
      });
    });
    return json;
  },

  getHash: function() {
    if (!this.hash) {
      this.hash = sha1(this.getRaw()).toUpperCase();
    }
    return this.hash;
  },

  getRaw: function() {
    return require('../lib/rawer').getBlockWithoutSignature(this);
  },

  getRawSigned: function() {
    return require('../lib/rawer').getBlock(this);
  },

  display: function (done) {
    console.log('------------------');
    console.log('Block#%s', this.number);
    done();
  },

  quickDescription: function () {
    var desc = '#' + this.number + ' (';
    desc += this.identities.length + ' newcomers, ' + this.certifications.length + ' certifications)';
    return desc;
  }
};

BlockSchema.statics.nextNumber = function (done) {
  this.current(function (err, kb) {
    var number = err ? -1 : kb.number;
    done(null, number + 1);
  });
};

BlockSchema.statics.lastOfIssuer = function (issuer, done) {
  this
    .find({ issuer: issuer })
    .sort({ 'number': -1 })
    .limit(1)
    .exec(function (err, blocks) {
      done(err, (blocks && blocks.length == 1) ? blocks[0] : null);
  });
};

BlockSchema.statics.current = function (done) {

  this.find({}).sort({ number: -1 }).limit(1).exec(function (err, blocks) {
    if(blocks && blocks.length == 1){
      done(err, blocks[0]);
      return;
    }
    else {
      done('No current keyblock');
      return;
    }
  });
};

BlockSchema.statics.findByNumberAndHash = function (number, hash, done) {

  this.find({ number: number, hash: hash }, function (err, blocks) {
    if(blocks && blocks.length == 1){
      done(err, blocks[0]);
      return;
    }
    if(!blocks || blocks.length == 0){
      done('No keyblock found');
      return;
    }
    if(blocks || blocks.length > 1){
      done('More than one keyblock found');
    }
  });
};

BlockSchema.statics.findByNumber = function (number, done) {

  this.find({ number: number }, function (err, blocks) {
    if(blocks && blocks.length == 1){
      done(err, blocks[0]);
      return;
    }
    if(!blocks || blocks.length == 0){
      done('No keyblock found');
      return;
    }
    if(blocks || blocks.length > 1){
      done('More than one keyblock found');
    }
  });
};

BlockSchema.statics.getLastStatusOfMember = function (member, kbNumberLimit, done) {

  var that = this;
  var criterias = { number: { $lte: kbNumberLimit }, membersChanges: new RegExp("^(\\+|-)" + member + "$")};
  async.waterfall([
    function (next){
      that
        .find(criterias)
        .sort({ 'number': -1 })
        .limit(1)
        .exec(function (err, ams) {
          next(err, ams);
        });
    },
    function (ams, next){
      if (ams.length == 1) {
        if (~ams[0].membersChanges.indexOf("+" + member)) {
          // Last time, member was joining
          next(null, 1);
        } else {
          // Last time, member was leaving
          next(null, -1);
        }
      } else {
        // Member has never been seen
        next(null, 0);
      }
    },
  ], done);
};

BlockSchema.statics.isMember = function (member, kbNumber, done) {

  var that = this;
  async.waterfall([
    function (next){
      that.getLastStatusOfMember(member, kbNumber, next);
    },
    function (status, next){
      next(null, status > 0);
    },
  ], done);
};

BlockSchema.statics.isMemberForKB = function (member, kbNumber, kbHash, done) {

  this.searchPresence(member, kbNumber, kbHash, checkIsJoiningMember, checkIsLeavingMember, this.searchPresence.bind(this), done);
};

BlockSchema.statics.searchPresence = function (member, kbNumber, kbHash, isJoining, isLeaving, searchCallBack, done) {
  var that = this;
  async.waterfall([
    function(next){
      that.findByNumberAndHash(kbNumber, kbHash, next);
    },
    function (kb, next) {
      if (isJoining(kb, member)) {
        // Is a member
        next(null, true);
      } else if (isLeaving(kb, member)) {
        // Not a member
        next(null, false);
      } else if (kb.number > 0) {
        // Not present in this keyblock, check previous
        logger.debug("searchPresence callback %s to %s", kb.number, kb.number -1);
        searchCallBack(member, kb.number - 1, kb.previousHash, isJoining, isLeaving, searchCallBack, next);
      } else {
        // No occurrence found
        next(null, false);
      }
    }
  ], done);
};

function checkIsJoiningMember (am, key) { return ~am.membersChanges.indexOf('+' + key); }
function checkIsLeavingMember (am, key) { return ~am.membersChanges.indexOf('-' + key); }

module.exports = BlockSchema;