import { test, expect } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, stat, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { archiveHistory, verifyArchive, databaseHistory, exportOptions, type HistorySource } from "../src/history/archive.ts";
import { connectSurreal, surrealConfig, surrealReachable } from "../src/provider/surreal.ts";
const fake: HistorySource = {inspect:async()=>({tables:["inbox"],counts:{inbox:1}}),export:async()=>"CREATE inbox:old SET text = 'preserved';\n"};
test("archive is private, verified, exact local bytes, and refuses overwrites",async()=>{
 const root=await mkdtemp(join(tmpdir(),'history-'));try{
  await mkdir(join(root,'decisions'));await writeFile(join(root,'decisions','record.md'),'\ufeff# Exact\r\n');
  const output=join(root,'archive');await archiveHistory(fake,{tenant:'acme',tenantDir:root,output});
  expect((await stat(output)).mode&0o777).toBe(0o700);expect((await stat(join(output,'history.surql'))).mode&0o777).toBe(0o600);
  expect(await verifyArchive(output)).toEqual({tenant:'acme',counts:{inbox:1}});
  const files=JSON.parse(await readFile(join(output,'decisions.json'),'utf8'));expect(Buffer.from(files['record.md'],'base64').toString()).toBe('\ufeff# Exact\r\n');
  await expect(archiveHistory(fake,{tenant:'acme',tenantDir:root,output})).rejects.toThrow();
  await writeFile(join(output,'history.surql'),'tampered');await expect(verifyArchive(output)).rejects.toThrow('integrity');
 }finally{await rm(root,{recursive:true,force:true})}
});
test("concurrent changes and symlinks fail without a partial archive",async()=>{
 const root=await mkdtemp(join(tmpdir(),'history-'));try{
  let n=0;const source={...fake,export:async()=>String(n++)};const output=join(root,'archive');
  await expect(archiveHistory(source,{tenant:'acme',tenantDir:root,output})).rejects.toThrow('changed');
  expect(await stat(output).catch(()=>null)).toBeNull();
  await symlink(root,join(root,'decisions'));await expect(archiveHistory(fake,{tenant:'acme',tenantDir:root,output})).rejects.toThrow('symlink');
 }finally{await rm(root,{recursive:true,force:true})}
});
test("export whitelist excludes authentication and other data",()=>{
 expect(exportOptions(['inbox'])).toMatchObject({tables:['inbox'],users:false,accesses:false,params:false,functions:false});
});
const cfg=surrealConfig('acme_history_archive_test');const available=await surrealReachable(cfg);
(available?test:test.skip)("native export restores identifiers, datetime and cross-record links without changing the source",async()=>{
 const root=await mkdtemp(join(tmpdir(),'history-db-'));const db=await connectSurreal(cfg);
 try{
  await db.query("DEFINE TABLE inbox SCHEMALESS; DEFINE TABLE decision SCHEMALESS; DEFINE TABLE credential SCHEMALESS; CREATE credential:secret SET pass = 'DO-NOT-EXPORT'; CREATE decision:one SET title = 'Original'; CREATE inbox:one SET user = user:ada, text = 'Keep', at = d'2020-01-02T03:04:05.123456789Z', records = [decision:one];");
  const before=await db.query("SELECT * FROM inbox");
  await archiveHistory(databaseHistory(db),{tenant:cfg.db,tenantDir:root,output:join(root,'archive')});
  const sql=await readFile(join(root,'archive','history.surql'),'utf8');expect(sql).not.toContain('DO-NOT-EXPORT');expect(sql).not.toContain('credential');
  expect(await db.query("SELECT * FROM inbox")).toEqual(before);
  await db.use({namespace:cfg.ns,database:'acme_history_restore_test'});await db.import(sql);
  expect(await db.query("SELECT * FROM inbox")).toEqual(before);
  expect(String((await db.query<any[]>("SELECT * FROM inbox"))[0][0].records[0])).toBe('decision:one');
 }finally{await db.query('REMOVE DATABASE acme_history_restore_test; REMOVE DATABASE acme_history_archive_test;');await db.close();await rm(root,{recursive:true,force:true})}
});

import { restrictLegacyHistory } from "../src/history/retire.ts";
import { applyGraph } from "../src/graph/apply.ts";
import { connectWithToken, mintIdentityJwt } from "../src/provider/surreal.ts";
import { exampleDefinition, exampleUsers } from "../fixtures/example/graph.ts";
(available?test:test.skip)("cutover denies old clients while preserving all historical records through repeated deploys", async()=>{
 const cfg=surrealConfig('acme_history_retire_test');const db=await connectSurreal(cfg);
 try{
  await applyGraph(db,exampleDefinition,exampleUsers,{reset:true});
  const [fresh]=await db.query<[{tables:Record<string,unknown>}]>('INFO FOR DB');
  expect(Object.keys(fresh.tables)).not.toContain('decision_log');
  await db.query("DEFINE TABLE inbox SCHEMALESS PERMISSIONS FULL; CREATE inbox:old SET text = 'Keep', user = user:cleo; DEFINE TABLE decision SCHEMALESS PERMISSIONS FULL; CREATE decision:old SET title = 'Keep';");
  const before=await db.query('SELECT * FROM inbox; SELECT * FROM decision');
  await restrictLegacyHistory(db);
  const own=await connectWithToken(cfg,mintIdentityJwt(cfg,'cleo'));
  try {
   expect(await own.query('SELECT * FROM inbox; SELECT * FROM decision')).toEqual([[],[]]);
   await own.query("UPDATE inbox:old SET text = 'Overwrite'; DELETE decision:old; CREATE inbox:another SET text = 'Append';");
  } finally {await own.close()}
  await applyGraph(db,exampleDefinition,exampleUsers);
  expect(await db.query('SELECT * FROM inbox; SELECT * FROM decision')).toEqual(before);
 }finally{await db.query('REMOVE DATABASE acme_history_retire_test');await db.close()}
});
