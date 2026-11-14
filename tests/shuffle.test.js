import assert from 'node:assert/strict';
import test from 'node:test';
import { optionOrders } from '../workers/api/src/shuffle.js';

test('optionOrders: 各問の並び順は 0〜3 の並べ替えで、同じセッションなら必ず同じになる', async () => {
  const orders = await optionOrders('session-a', 50);
  assert.equal(orders.length, 50);
  for (const order of orders) assert.deepEqual([...order].sort(), [0, 1, 2, 3]);
  assert.deepEqual(await optionOrders('session-a', 50), orders, '開始時と採点時で同じ順番');
  assert.notDeepEqual(await optionOrders('session-b', 50), orders, 'セッションが違えば順番も変わる');
});

test('optionOrders: 正解の位置が偏らない（多くのセッションで 4 か所にほぼ均等に散る）', async () => {
  const counts = [0, 0, 0, 0];
  for (let index = 0; index < 2000; index += 1) {
    const [order] = await optionOrders(`session-${index}`, 1);
    counts[order.indexOf(0)] += 1; // 元の位置 0 の選択肢がどこに表示されたか
  }
  for (const count of counts) assert.ok(count > 400 && count < 600, `偏りすぎ: ${counts}`);
});
