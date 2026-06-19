name: Tester
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install --save-dev jsdom
      - run: node test.js
      - run: node test-intranet.js
