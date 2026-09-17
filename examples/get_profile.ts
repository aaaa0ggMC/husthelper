import hust from "../index.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig();

const client = hust
  .auth({ user_name: config.un, password: config.pwd })
  .withStdChar();

const profile = await client.getEcardProfile();

console.log("姓名:", profile.name);
console.log("编号:", profile.id);
console.log("校园卡余额:", profile.cardBalance);
console.log("电子账户余额:", profile.eWalletBalance);

for (const section of profile.sections) {
  console.log(`# ${section.title}`);
  for (const { label, value } of section.fields) {
    console.log(`  ${label}: ${value}`);
  }
}
