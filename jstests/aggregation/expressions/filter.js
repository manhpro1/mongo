// Test $filter aggregation expression.
//
// @tags: [
//   # Can't set the 'failOnPoisonedFieldLookup' failpoint on mongos.
//   assumes_against_mongod_not_mongos,
// ]

load('jstests/aggregation/extras/utils.js');        // For assertErrorCode.
load("jstests/libs/sbe_assert_error_override.js");  // Override error-code-checking APIs.

(function() {
'use strict';

var coll = db.agg_filter_expr;
coll.drop();

assert.commandWorked(coll.insert({_id: 0, c: 1, d: 3, a: [1, 2, 3, 4, 5]}));
assert.commandWorked(coll.insert({_id: 1, c: 2, d: 4, a: [1, 2]}));
assert.commandWorked(coll.insert({_id: 2, c: 3, d: 5, a: []}));
assert.commandWorked(coll.insert({_id: 3, c: 4, d: 6, a: [4]}));
assert.commandWorked(coll.insert({_id: 4, c: 5, d: 7, a: null}));
assert.commandWorked(coll.insert({_id: 5, c: 6, d: 8, a: undefined}));
assert.commandWorked(coll.insert({_id: 6, c: 7, d: 9}));

// Create filter to only accept numbers greater than 2.
filterDoc = {input: '$a', as: 'x', cond: {$gt: ['$$x', 2]}};
var expectedResults = [
    {_id: 0, b: [3, 4, 5]},
    {_id: 1, b: []},
    {_id: 2, b: []},
    {_id: 3, b: [4]},
    {_id: 4, b: null},
    {_id: 5, b: null},
    {_id: 6, b: null},
];
var results = coll.aggregate([{$project: {b: {$filter: filterDoc}}}, {$sort: {_id: 1}}]).toArray();
assert.eq(results, expectedResults);

// Create filter that uses the default variable name in 'cond'.
filterDoc = {
    input: '$a',
    cond: {$eq: [2, '$$this']}
};
expectedResults = [
    {_id: 0, b: [2]},
    {_id: 1, b: [2]},
    {_id: 2, b: []},
    {_id: 3, b: []},
    {_id: 4, b: null},
    {_id: 5, b: null},
    {_id: 6, b: null},
];
results = coll.aggregate([{$project: {b: {$filter: filterDoc}}}, {$sort: {_id: 1}}]).toArray();
assert.eq(results, expectedResults);

// Create filter with path expressions inside $let expression.
results = coll.aggregate([
    {
        $project: {
            b: {
                $let: {
                    vars: {
                        value: '$d'
                    },
                    in: {
                        $filter: {
                            input: '$a',
                            cond: {$gte: [{$add: ['$c', '$$this']}, '$$value']}
                        }
                    }
                }
            }
        }
    },
    {$sort: {_id: 1}}
]).toArray();
expectedResults = [
    {_id: 0, b: [2, 3, 4, 5]},
    {_id: 1, b: [2]},
    {_id: 2, b: []},
    {_id: 3, b: [4]},
    {_id: 4, b: null},
    {_id: 5, b: null},
    {_id: 6, b: null},
];
assert.eq(results, expectedResults);

// Create filter that uses the $and and $or.
filterDoc = {
    input: '$a',
    cond: {$or: [{$and: [{$gt: ['$$this', 1]}, {$lt: ['$$this', 3]}]}, {$eq: ['$$this', 5]}]}
};
expectedResults = [
    {_id: 0, b: [2, 5]},
    {_id: 1, b: [2]},
    {_id: 2, b: []},
    {_id: 3, b: []},
    {_id: 4, b: null},
    {_id: 5, b: null},
    {_id: 6, b: null},
];
results = coll.aggregate([{$project: {b: {$filter: filterDoc}}}, {$sort: {_id: 1}}]).toArray();
assert.eq(results, expectedResults);

// Nested $filter expression. Queries below do not make sense from the user perspective, but allow
// us to test complex SBE trees generated by expressions like $and, $or, $cond and $switch with
// $filter inside them.

// Create filter as an argument to $and and $or expressions.
expectedResults = [
    {_id: 0, b: true},
    {_id: 1, b: true},
    {_id: 2, b: true},
    {_id: 3, b: true},
    {_id: 4, b: false},
    {_id: 5, b: false},
    {_id: 6, b: false},
];
results = coll.aggregate([
                  {
                      $project: {
                          b: {
                              $or: [
                                  {
                                      $and: [
                                          {
                                              $filter: {
                                                  input: '$a',
                                                  cond: {
                                                      $or: [
                                                          {
                                                              $and: [
                                                                  {$gt: ['$$this', 1]},
                                                                  {$lt: ['$$this', 3]}
                                                              ]
                                                          },
                                                          {$eq: ['$$this', 5]}
                                                      ]
                                                  }
                                              }
                                          },
                                          '$d'
                                      ]
                                  },
                                  {$filter: {input: '$a', cond: {$eq: ['$$this', 1]}}}
                              ]
                          }
                      }
                  },
                  {$sort: {_id: 1}}
              ])
              .toArray();
assert.eq(results, expectedResults);

// Create filter as an argument to $cond expression.
expectedResults = [
    {_id: 0, b: [2]},
    {_id: 1, b: [2]},
    {_id: 2, b: []},
    {_id: 3, b: []},
    {_id: 4, b: null},
    {_id: 5, b: null},
    {_id: 6, b: null},
];
results = coll.aggregate([
                  {
                      $project: {
                          b: {
                              $cond: {
                                  if: {$filter: {input: '$a', cond: {$eq: ['$$this', 1]}}},
                                  then: {$filter: {input: '$a', cond: {$eq: ['$$this', 2]}}},
                                  else: {$filter: {input: '$a', cond: {$eq: ['$$this', 3]}}}
                              }
                          }
                      }
                  },
                  {$sort: {_id: 1}}
              ])
              .toArray();
assert.eq(results, expectedResults);

// Create filter as an argument to $switch expression.
expectedResults = [
    {_id: 0, b: [2]},
    {_id: 1, b: [2]},
    {_id: 2, b: []},
    {_id: 3, b: []},
    {_id: 4, b: null},
    {_id: 5, b: null},
    {_id: 6, b: null},
];
results =
    coll.aggregate([
            {
                $project: {
                    b: {
                        $switch: {
                            branches: [
                                {
                                    case: {$filter: {input: '$a', cond: {$eq: ['$$this', 1]}}},
                                    then: {$filter: {input: '$a', cond: {$eq: ['$$this', 2]}}}
                                },
                                {
                                    case: {$filter: {input: '$a', cond: {$eq: ['$$this', 3]}}},
                                    then: {$filter: {input: '$a', cond: {$eq: ['$$this', 4]}}}
                                }
                            ],
                            default: {$filter: {input: '$a', cond: {$eq: ['$$this', 5]}}}
                        }
                    }
                }
            },
            {$sort: {_id: 1}}
        ])
        .toArray();
assert.eq(results, expectedResults);

// Invalid filter expressions.

// '$filter' is not a document.
var filterDoc = 'string';
assertErrorCode(coll, [{$project: {b: {$filter: filterDoc}}}], 28646);

// Extra field(s).
filterDoc = {input: '$a', as: 'x', cond: true, extra: 1};
assertErrorCode(coll, [{$project: {b: {$filter: filterDoc}}}], 28647);

// Missing 'input'.
filterDoc = {
    as: 'x',
    cond: true
};
assertErrorCode(coll, [{$project: {b: {$filter: filterDoc}}}], 28648);

// Missing 'cond'.
filterDoc = {input: '$a', as: 'x'};
assertErrorCode(coll, [{$project: {b: {$filter: filterDoc}}}], 28650);

// 'as' is not a valid variable name.
filterDoc = {input: '$a', as: '$x', cond: true};
assertErrorCode(coll, [{$project: {b: {$filter: filterDoc}}}], ErrorCodes.FailedToParse);

// 'input' is not an array.
filterDoc = {input: 'string', as: 'x', cond: true};
assertErrorCode(coll, [{$project: {b: {$filter: filterDoc}}}], 28651);

// 'cond' uses undefined variable name.
filterDoc = {
    input: '$a',
    cond: {$eq: [1, '$$var']}
};
assertErrorCode(coll, [{$project: {b: {$filter: filterDoc}}}], 17276);

assert(coll.drop());
assert.commandWorked(coll.insert({a: 'string'}));
filterDoc = {input: '$a', as: 'x', cond: true};
assertErrorCode(coll, [{$project: {b: {$filter: filterDoc}}}], 28651);

// Create filter with non-bool predicate.
assert(coll.drop());
const date = new Date();
assert.commandWorked(
    coll.insert({_id: 0, a: [date, null, undefined, 0, false, NumberDecimal('1'), [], {c: 3}]}));
expectedResults = [
    {_id: 0, b: [date, NumberDecimal('1'), [], {c: 3}]},
];
results =
    coll.aggregate([{$project: {b: {$filter: {input: '$a', as: 'x', cond: '$$x'}}}}]).toArray();
assert.eq(results, expectedResults);

// Create filter with deep path expressions.
assert(coll.drop());
assert.commandWorked(coll.insert({
    _id: 0,
    a: [
        {b: {c: {d: 1}}},
        {b: {c: {d: 2}}},
        {b: {c: {d: 3}}},
        {b: {c: {d: 4}}},
    ]
}));

filterDoc = {
    input: '$a',
    cond: {$gt: ['$$this.b.c.d', 2]}
};
expectedResults = [
    {_id: 0, b: [{b: {c: {d: 3}}}, {b: {c: {d: 4}}}]},
];
results = coll.aggregate([{$project: {b: {$filter: filterDoc}}}]).toArray();
assert.eq(results, expectedResults);

// Create nested filter.
assert(coll.drop());
assert.commandWorked(coll.insert({_id: 0, a: [[1, 2, 3], null, [4, 5, 6]]}));

expectedResults = [
    {_id: 0, b: [[1, 2, 3], [4, 5, 6]]},
];
results = coll.aggregate([{
                  $project: {
                      b: {
                          $filter: {
                              input: '$a',
                              cond: {$filter: {input: '$$this', cond: {$gt: ['$$this', 3]}}}
                          }
                      }
                  }
              }])
              .toArray();
assert.eq(results, expectedResults);

// Test short-circuiting in $and and $or inside $filter expression.
coll.drop();
assert.commandWorked(coll.insert({_id: 0, a: [-1, -2, -3, -4]}));

// Lookup of '$POISON' field will always fail with this fail point enabled.
assert.commandWorked(
    db.adminCommand({configureFailPoint: "failOnPoisonedFieldLookup", mode: "alwaysOn"}));

// Create filter with $and expression containing '$POISON' in it.
expectedResults = [
    {_id: 0, b: []},
];
results =
    coll.aggregate([{
            $project:
                {b: {$filter: {input: '$a', cond: {$and: [{$gt: ['$$this', 0]}, '$POISON']}}}}
        }])
        .toArray();
assert.eq(results, expectedResults);

// Create filter with $or expression containing '$POISON' in it.
expectedResults = [
    {_id: 0, b: [-1, -2, -3, -4]},
];
results =
    coll.aggregate([{
            $project:
                {b: {$filter: {input: '$a', cond: {$or: [{$lt: ['$$this', 0]}, '$POISON']}}}}
        }])
        .toArray();
assert.eq(results, expectedResults);

// Create filter with $and expression containing invalid call to $ln in it.
expectedResults = [
    {_id: 0, b: []},
];
results =
    coll.aggregate([{
            $project:
                {b: {$filter: {input: '$a', cond: {$and: [{$gt: ['$$this', 0]}, {$ln: '$$this'}]}}}}
        }])
        .toArray();
assert.eq(results, expectedResults);

// Create filter with $or expression containing invalid call to $ln in it.
expectedResults = [
    {_id: 0, b: [-1, -2, -3, -4]},
];
results =
    coll.aggregate([{
            $project:
                {b: {$filter: {input: '$a', cond: {$or: [{$lt: ['$$this', 0]}, {$ln: '$$this'}]}}}}
        }])
        .toArray();
assert.eq(results, expectedResults);
}());
