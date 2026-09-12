import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(".langdbg-data/lookatstudy.db");
const KEY = "7b0ce60644d742c19c1a28dc1d91ed15.CS6utdCpXloqpSOO";
db.prepare("INSERT OR REPLACE INTO custom_providers (id,label,kind,protocol,base_url,api_key,default_model,models_json,vision) VALUES (?,?,?,?,?,?,?,?,?)")
  .run("custom-9c69cd95","zai","llm","openai-compatible","https://api.z.ai/api/coding/paas/v4",KEY,"glm-5.3-flash",null,1);
const set = db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)");
set.run("active_provider","custom-9c69cd95");
set.run("active_model","glm-5.3-flash");
set.run("vision_provider_override","");
set.run("vision_model_override","");
console.log("provider 行 + settings 注入完成");
