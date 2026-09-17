import fs from "node:fs";
import hust from "../index.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig();

const client = hust
  .auth({ user_name: config.un, password: config.pwd, account: config.account })
  .withAiOcr({
    baseURL: config.openai.baseURL,
    apiKey: config.openai.apiKey,
    model: config.openai.model,
    maxTokens: config.openai.maxTokens,
    timeout: config.openai.timeout,
    onImage: config.saveDebugImage ? (jpg) => fs.writeFileSync("captcha.jpg", jpg) : undefined,
  });

try {
  const page = await client.getTransactions({ page: 1 });
  console.log(`第 1 页: ${page.records.length}/${page.total} 条，下一页: ${page.nextPage}`);
  console.log(page.records[0]);

  let count = 0;
  for await (const record of client.iterateTransactions({})) {
    count++;
    console.log(`${count}. ${record.occtime} ${record.mercname} ${record.sign_tranamt}`);
  }
  console.log(`遍历完成，共 ${count} 条`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
