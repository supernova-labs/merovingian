import { expect, test } from "bun:test";
import { AuthenticationError, ConnectionUnavailableError, InternalError, NotFoundError, type Surreal } from "surrealdb";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createJournalServer } from "../src/mcp/journal.ts";
import { createCatalogServer } from "../src/mcp/catalog.ts";
import { CatalogError } from "../src/catalog/catalog.ts";
import { bounded, operationError, OperationTimeout } from "../src/provider/operation-error.ts";

async function call(connect:()=>Promise<Surreal>, name="list-journals", args:Record<string,unknown>={}, timeoutMs=100) {
  const server=createJournalServer(connect,timeoutMs);
  const [ct,st]=InMemoryTransport.createLinkedPair();await server.connect(st);
  const client=new Client({name:"test",version:"1"});await client.connect(ct);
  try {
    const result=await client.callTool({name,arguments:args});
    return {isError:result.isError,...JSON.parse((result.content as {text:string}[])[0]!.text)};
  } finally {await client.close();await server.close();}
}
const db=(query:(sql:string)=>Promise<unknown>,close=async()=>{})=>({query,close}) as unknown as Surreal;

test("connection and identity failures are actionable and never expose credentials",async()=>{
  for(const [error,code] of [
    [new AuthenticationError("SECRET_PASSWORD"),"invalid_credentials"],
    [new ConnectionUnavailableError(),"connection_failed"],
    [Object.assign(new Error("wss://private.example SECRET_PASSWORD"),{code:"ECONNREFUSED"}),"connection_failed"],
    [new OperationTimeout(),"timeout"],
    [new Error("private query SECRET_PASSWORD"),"unavailable"],
  ] as const) {
    for(const name of ["list-journals","append-journal"]) {
      const result=await call(async()=>{throw error;},name,name==="append-journal"?{text:"sensitive note"}:{});
      expect(result.isError).toBe(true);expect(result.error.code).toBe(code);
      expect(result.error.phase).toBe("connect");
      expect(result.error.writeOutcome).toBe(name==="list-journals"?"not_applicable":"not_submitted");
      expect(JSON.stringify(result)).not.toContain("SECRET");expect(JSON.stringify(result)).not.toContain("sensitive note");
      expect(result.error.message).not.toContain("may have completed");
    }
  }
});
test("SDK empty SIGNIN classification only applies during connection",()=>{
  for(const ErrorType of [InternalError,NotFoundError]) {
    const e=new ErrorType({code:0,kind:"Internal",message:"No record was returned"});
    expect(operationError(e,true).code).toBe("invalid_credentials");
    expect(operationError(e,false).code).toBe("unavailable");
  }
});
test("list query failure never warns of an ambiguous write",async()=>{
  const result=await call(async()=>db(async()=>{throw new Error("SECRET SQL");}));
  expect(result.error.phase).toBe("read");expect(result.error.writeOutcome).toBe("not_applicable");
  expect(result.error.message).toContain("retry the list");expect(JSON.stringify(result)).not.toContain("SECRET");
});
test("failed reference lookup does not submit a write",async()=>{
  let queries=0;
  const result=await call(async()=>db(async()=>{queries++;return [[]];}),"append-journal",{text:"note",previous:"missing"});
  expect(result.error.code).toBe("reference_unavailable");expect(result.error.writeOutcome).toBe("not_submitted");expect(queries).toBe(1);
});
test("reference timeout cannot submit an append later when the lookup resolves",async()=>{
  let finish!:(value:unknown)=>void,queries=0;
  const result=await call(async()=>db(async()=>{queries++;return new Promise(resolve=>{finish=resolve;});}),"append-journal",{text:"note",previous:"slow"},5);
  expect(result.error.code).toBe("timeout");expect(result.error.writeOutcome).toBe("not_submitted");
  finish([[{id:"slow"}]]);await Promise.resolve();await Promise.resolve();expect(queries).toBe(1);
});
test("submitted append failures remain ambiguous, without automatic retry",async()=>{
  for(const response of [async()=>{throw new ConnectionUnavailableError();},async()=>[[]],async()=>new Promise(()=>{})]) {
    let writes=0;
    const result=await call(async()=>db(async()=>{writes++;return response();}),"append-journal",{text:"note"},5);
    expect(result.error.writeOutcome).toBe("unknown");expect(result.error.phase).toBe("write");
    expect(result.error.message).toContain("List journals");expect(writes).toBe(1);
  }
});
test("cleanup failures cannot replace a successful append",async()=>{
  const result=await call(async()=>db(async()=>[[{id:"entry"}]],async()=>{throw new Error("secret cleanup");}),"append-journal",{text:"note"});
  expect(result.isError).toBe(false);expect(result.entry.id).toBe("entry");
});
test("bounded read times out with a typed failure",async()=>{
  await expect(bounded(new Promise(()=>{}),5)).rejects.toBeInstanceOf(OperationTimeout);
});
test("catalog MCP preserves safe actionable error codes",async()=>{
  const server=createCatalogServer(async()=>{const e=operationError(new OperationTimeout(),true);throw new CatalogError(e.code,e.message);});
  const [ct,st]=InMemoryTransport.createLinkedPair();await server.connect(st);
  const client=new Client({name:"test",version:"1"});await client.connect(ct);
  try {const result=await client.callTool({name:"identity",arguments:{}});
    expect(result.isError).toBe(true);expect(JSON.parse((result.content as {text:string}[])[0]!.text).error.code).toBe("timeout");
  } finally {await client.close();await server.close();}
});


test("CLI timeout retains safe phase and duration without returning driver details",async()=>{
  await expect(bounded(new Promise(()=>{}),5,"authenticate identity")).rejects.toThrow("Database authenticate identity timed out after 5ms");
  const safe=operationError(new OperationTimeout("authenticate identity",5),true);
  expect(safe.code).toBe("timeout");expect(safe.message).not.toContain("authenticate identity");
});
