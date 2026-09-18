import fs from "node:fs/promises";
import hust from "../hustpass/index.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig();

const client = hust
  .auth({ user_name: config.un, password: config.pwd, account: config.account })
  .withStdChar()
  .persistent(".hust-session.json");

try {
  let count = 0;
  const entries: any[] = [];
  
  // 生成最近 5 年的所有月份
  const now = new Date();
  const startYear = now.getFullYear() - 5;
  const months: string[] = [];
  for (let y = startYear; y <= now.getFullYear(); y++) {
    for (let m = 1; m <= 12; m++) {
      if (y === now.getFullYear() && m > now.getMonth() + 1) break;
      months.push(`${y}-${String(m).padStart(2, '0')}-01`);
    }
  }

  for (const month of months) {
    let monthCount = 0;
    try {
      for await (const record of client.ecard.iterateTransactions({ dateStatus: month })) {
        count++;
        monthCount++;
        
        const timeStr = String(record.occtime);
        let occurredAt = "";
        if (timeStr.length === 14) {
          occurredAt = `${timeStr.slice(0, 4)}-${timeStr.slice(4, 6)}-${timeStr.slice(6, 8)} ${timeStr.slice(8, 10)}:${timeStr.slice(10, 12)}:${timeStr.slice(12, 14)}`;
        } else {
          occurredAt = timeStr;
        }

        const sign_tranamt = Number(record.sign_tranamt);
        const direction = sign_tranamt < 0 ? 'expense' : 'income';
        const amountCents = Math.abs(sign_tranamt);
        const amount = (amountCents / 100).toFixed(2);
        
        entries.push({
          occurredAt,
          amount,
          direction,
          category: record.tranname ? String(record.tranname) : '校园卡消费',
          counterparty: record.mercname ? String(record.mercname) : '',
          method: '校园卡',
          note: record.remark ? String(record.remark) : '',
          source: 'ecard',
          merchant_order_no: record.mercacc ? String(record.mercacc) : undefined
        });
      }
      process.stdout.write(`\r已拉取 ${count} 条记录... (当前查询月份: ${month}, ${monthCount}条)`);
    } catch (error) {
      // 忽略部分可能没有记录的报错
    }
  }
  
  console.log(`\n遍历完成，共 ${count} 条，开始写入 ecard_ledger.json`);
  
  await fs.writeFile("ecard_ledger.json", JSON.stringify({ entries }, null, 2), "utf8");
  console.log("写入完成！你可以使用 `ledger add --input ecard_ledger.json` 导入账单。");
  
} catch (error) {
  console.error("\n" + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
}
