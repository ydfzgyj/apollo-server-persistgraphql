import { graphqlKoa } from 'apollo-server-koa'
import { graphqlExpress } from 'apollo-server-express'
import { graphql, GraphQLInt, GraphQLObjectType, GraphQLSchema, GraphQLString } from 'graphql'
import http from 'http'
import Koa from 'koa'
import koaBodyParser from 'koa-bodyparser'
import express from 'express'
import expressBodyParser from 'body-parser'
import KoaRouter from 'koa-router'
import request from 'supertest'
import { PersistedGraphQL } from './index.esm.js'

const queryType = new GraphQLObjectType({
  name: 'QueryType',
  fields: {
    test: {
      type: GraphQLString,
      resolve () {
        return 'it works'
      }
    },
    doubleClick: {
      type: GraphQLInt,
      resolve () {
        return 666
      }
    }
  }
})

const schema = new GraphQLSchema({
  query: queryType
})

function createKoa (persistedGraphQL, onlyWhiteList) {
  const app = new Koa()
  const router = new KoaRouter()
  app.use(koaBodyParser())
  router.all('/graphql', graphqlKoa(ctx => persistedGraphQL.transform({ schema }, {
    koa: ctx,
    onlyWhiteList
  })))
  app.use(router.routes())
  app.use(router.allowedMethods())
  return http.createServer(app.callback())
}

function createExpress (persistedGraphQL) {
  const app = express()
  app.use('/graphql', expressBodyParser.json(), graphqlExpress(req => persistedGraphQL.transform({ schema }, { express: req })))
  return http.createServer(app)
}

describe('PersistedGraphQL', () => {
  describe('constructor', () => {
    it('default', () => {
      const persistedGraphQL = new PersistedGraphQL()
      expect(persistedGraphQL.errorType).toBe('PersistedQueryError')
    })
    it('custom errorType', () => {
      const persistedGraphQL = new PersistedGraphQL(null, 'CustomPersistedQueryError')
      expect(persistedGraphQL.errorType).toBe('CustomPersistedQueryError')
    })
  })
  describe('update schema', () => {
    it('pass nothing', () => {
      const persistedGraphQL = new PersistedGraphQL()
      expect(() => persistedGraphQL.updateSchema()).toThrowError('You must pass a valid GraphQL schema.')
    })
    it('pass error schema', () => {
      const persistedGraphQL = new PersistedGraphQL()
      expect(() => persistedGraphQL.updateSchema({})).toThrowError('You must pass a valid GraphQL schema.')
    })
    it('pass schema', () => {
      const persistedGraphQL = new PersistedGraphQL()
      persistedGraphQL.updateSchema(schema)
      expect(graphql(persistedGraphQL.schema, `{ test }`)).resolves.toEqual({ data: { test: 'it works' } })
      expect(graphql(persistedGraphQL.schema, `{ PersistedQueryError(err: "test") }`)).resolves.toEqual({ data: { PersistedQueryError: 'test' } })
    })
    it('init schema', () => {
      const persistedGraphQL = new PersistedGraphQL(schema)
      expect(graphql(persistedGraphQL.schema, `{ test }`)).resolves.toEqual({ data: { test: 'it works' } })
      expect(graphql(persistedGraphQL.schema, `{ PersistedQueryError(err: "test") }`)).resolves.toEqual({ data: { PersistedQueryError: 'test' } })
    })
  })
  describe('add available query', () => {
    it('add graphql file', () => {
      const persistedGraphQL = new PersistedGraphQL()
      persistedGraphQL.addQueryFiles(process.cwd() + '/test/test.graphql')
      expect(persistedGraphQL._availableQueries).toEqual({
        b64e723fc9713bdf669f79a2e32b844965bd33c4500b8ce74713967e1ddb3fe7: '{\n  test\n}\n'
      })
    })
    it('add json file', () => {
      const persistedGraphQL = new PersistedGraphQL()
      persistedGraphQL.addQueryFiles(process.cwd() + '/test/extracted_queries.json')
      expect(persistedGraphQL._availableQueries).toEqual({
        b64e723fc9713bdf669f79a2e32b844965bd33c4500b8ce74713967e1ddb3fe7: '{\n  test\n}\n'
      })
    })
    it('add directory', () => {
      const persistedGraphQL = new PersistedGraphQL()
      persistedGraphQL.addQueryFiles(process.cwd() + '/test/')
      expect(persistedGraphQL._availableQueries).toEqual({
        b64e723fc9713bdf669f79a2e32b844965bd33c4500b8ce74713967e1ddb3fe7: '{\n  test\n}\n',
        afba65219417c62b36dbfd384d077370fb714ce83742ca79e82e5b37967d8c7e: '{\n  doubleClick\n}\n'
      })
    })
    it('ignore useless file', () => {
      const persistedGraphQL = new PersistedGraphQL()
      persistedGraphQL.addQueryFiles(process.cwd() + '/README.md')
      expect(persistedGraphQL._availableQueries).toEqual({})
    })
  })
  describe('transform options', () => {
    it('pass nothing to options', () => {
      const persistedGraphQL = new PersistedGraphQL()
      expect(() => persistedGraphQL.transform({ schema })).toThrowError('You must pass one server instance.')
    })
    it('pass empty object to options', () => {
      const persistedGraphQL = new PersistedGraphQL()
      expect(() => persistedGraphQL.transform({ schema }, {})).toThrowError('You must pass one server instance.')
    })
    it('pass custom format response function', async () => {
      const persistedGraphQL = new PersistedGraphQL()
      const app = new Koa()
      const router = new KoaRouter()
      app.use(koaBodyParser())
      router.all('/graphql', graphqlKoa(ctx => persistedGraphQL.transform({
        schema,
        formatResponse (rsp) {
          rsp.data.test = 'it works better'
          return rsp
        }
      }, { koa: ctx })))
      app.use(router.routes())
      app.use(router.allowedMethods())
      const koa = await http.createServer(app.callback())
      persistedGraphQL.addQueryFiles(process.cwd() + '/test/')
      const rsp = await request(koa).get('/graphql').query({
        extensions: JSON.stringify({
          persistedQuery: {
            version: 1,
            sha256Hash: 'b64e723fc9713bdf669f79a2e32b844965bd33c4500b8ce74713967e1ddb3fe7'
          }
        })
      })
      expect(rsp.body).toEqual({ data: { test: 'it works better' } })
    })
  })
  describe('koa context', () => {
    it('get persisted query', async () => {
      const persistedGraphQL = new PersistedGraphQL()
      const koa = await createKoa(persistedGraphQL)
      persistedGraphQL.addQueryFiles(process.cwd() + '/test/')
      const rsp = await request(koa).get('/graphql').query({
        extensions: JSON.stringify({
          persistedQuery: {
            version: 1,
            sha256Hash: 'b64e723fc9713bdf669f79a2e32b844965bd33c4500b8ce74713967e1ddb3fe7'
          }
        })
      })
      expect(rsp.body).toEqual({ data: { test: 'it works' } })
    })
    it('post persisted query', async () => {
      const persistedGraphQL = new PersistedGraphQL()
      const koa = await createKoa(persistedGraphQL)
      persistedGraphQL.addQueryFiles(process.cwd() + '/test/')
      const rsp = await request(koa).post('/graphql').send({
        extensions: {
          persistedQuery: {
            version: 1,
            sha256Hash: 'b64e723fc9713bdf669f79a2e32b844965bd33c4500b8ce74713967e1ddb3fe7'
          }
        }
      })
      expect(rsp.body).toEqual({ data: { test: 'it works' } })
    })
    it('batch post persisted query', async () => {
      const persistedGraphQL = new PersistedGraphQL()
      const koa = await createKoa(persistedGraphQL)
      persistedGraphQL.addQueryFiles(process.cwd() + '/test/')
      const rsp = await request(koa).post('/graphql').send([
        {
          extensions: {
            persistedQuery: {
              version: 1,
              sha256Hash: 'b64e723fc9713bdf669f79a2e32b844965bd33c4500b8ce74713967e1ddb3fe7'
            }
          }
        }, {
          extensions: {
            persistedQuery: {
              version: 1,
              sha256Hash: 'afba65219417c62b36dbfd384d077370fb714ce83742ca79e82e5b37967d8c7e'
            }
          }
        }
      ])
      expect(rsp.body).toEqual([{ data: { test: 'it works' } }, { data: { doubleClick: 666 } }])
    })
    it('wrong extensions string', async () => {
      const persistedGraphQL = new PersistedGraphQL()
      const koa = await createKoa(persistedGraphQL)
      const rsp = await request(koa).get('/graphql').query({
        extensions: '???'
      })
      expect(rsp.error.text).toEqual('Extensions are invalid JSON.')
    })
    it('ignore empty extensions', async () => {
      const persistedGraphQL = new PersistedGraphQL()
      const koa = await createKoa(persistedGraphQL)
      const rsp = await request(koa).post('/graphql').send({
        query: '{ test }',
        extensions: {}
      })
      expect(rsp.body).toEqual({ data: { test: 'it works' } })
    })
  })
  describe('express context', () => {
    it('get persisted query', async () => {
      const persistedGraphQL = new PersistedGraphQL()
      const express = await createExpress(persistedGraphQL)
      persistedGraphQL.addQueryFiles(process.cwd() + '/test/')
      const rsp = await request(express).get('/graphql').query({
        extensions: JSON.stringify({
          persistedQuery: {
            version: 1,
            sha256Hash: 'b64e723fc9713bdf669f79a2e32b844965bd33c4500b8ce74713967e1ddb3fe7'
          }
        })
      })
      expect(rsp.body).toEqual({ data: { test: 'it works' } })
    })
    it('post persisted query', async () => {
      const persistedGraphQL = new PersistedGraphQL()
      const express = await createExpress(persistedGraphQL)
      persistedGraphQL.addQueryFiles(process.cwd() + '/test/')
      const rsp = await request(express).post('/graphql').send({
        extensions: {
          persistedQuery: {
            version: 1,
            sha256Hash: 'b64e723fc9713bdf669f79a2e32b844965bd33c4500b8ce74713967e1ddb3fe7'
          }
        }
      })
      expect(rsp.body).toEqual({ data: { test: 'it works' } })
    })
  })
  describe('white list closed', () => {
    it('common query', async () => {
      const persistedGraphQL = new PersistedGraphQL()
      const koa = await createKoa(persistedGraphQL)
      const rsp = await request(koa).post('/graphql').send({
        query: '{ test }'
      })
      expect(rsp.body).toEqual({ data: { test: 'it works' } })
    })
    it('register the hash', async () => {
      const persistedGraphQL = new PersistedGraphQL()
      const koa = await createKoa(persistedGraphQL)
      const rsp = await request(koa).post('/graphql').send({
        extensions: {
          persistedQuery: {
            version: 1,
            sha256Hash: 'b64e723fc9713bdf669f79a2e32b844965bd33c4500b8ce74713967e1ddb3fe7'
          }
        }
      })
      expect(rsp.body).toEqual({ errors: [{ message: 'PersistedQueryNotFound' }] })
      const rsp2 = await request(koa).post('/graphql').send({
        query: '{ test }',
        extensions: {
          persistedQuery: {
            version: 1,
            sha256Hash: 'b64e723fc9713bdf669f79a2e32b844965bd33c4500b8ce74713967e1ddb3fe7'
          }
        }
      })
      expect(rsp2.body).toEqual({ data: { test: 'it works' } })
    })
  })
  describe('white list open', () => {
    it('common query', async () => {
      const persistedGraphQL = new PersistedGraphQL()
      const koa = await createKoa(persistedGraphQL, true)
      const rsp = await request(koa).post('/graphql').send({
        query: '{ test }'
      })
      expect(rsp.body).toEqual({ errors: [{ message: 'PersistedQueryNotAllowed' }] })
    })
    it('unregistered hash', async () => {
      const persistedGraphQL = new PersistedGraphQL()
      const koa = await createKoa(persistedGraphQL, true)
      const rsp = await request(koa).post('/graphql').send({
        extensions: {
          persistedQuery: {
            version: 1,
            sha256Hash: 'b64e723fc9713bdf669f79a2e32b844965bd33c4500b8ce74713967e1ddb3fe7'
          }
        }
      })
      expect(rsp.body).toEqual({ errors: [{ message: 'PersistedQueryNotAllowed' }] })
    })
  })
})
