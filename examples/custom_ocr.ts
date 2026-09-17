import hust from "../index.ts";

declare function yourOcr(gif: Buffer): Promise<string>;

const client = hust
  .auth({ user_name: "U2025...", password: "your-password" })
  .withRawOcr((gif) => yourOcr(gif))
  .withLogger((message) => console.log(message));

const page = await client.ecard.getTransactions({ page: 1 });
console.log(`第 1 页: ${page.records.length}/${page.total} 条`);

for await (const record of client.ecard.iterateTransactions({ typeStatus: 1 })) {
  console.log(`${record.occtime} ${record.mercname} ${record.sign_tranamt}`);
}
