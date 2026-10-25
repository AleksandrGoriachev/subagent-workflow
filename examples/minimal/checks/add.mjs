const { add } = await import('../src/app.js');
if (add(1, 2) !== 3) {
  console.error('sum is wrong: ' + add(1, 2));
  process.exit(1);
}
console.log('ok ' + add(1, 2));
