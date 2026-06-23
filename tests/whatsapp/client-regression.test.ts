import * as fs from 'fs';
import * as path from 'path';

describe('WhatsApp client regression tests', () => {
  describe('Bug 2: WhatsApp client connect method', () => {
    it('connect method should be a plain async function, not new Promise(async)', () => {
      // Read the source file and check for the antipattern
      const sourcePath = path.join(__dirname, '../../src/whatsapp/client.ts');
      const source = fs.readFileSync(sourcePath, 'utf-8');

      // The method should NOT contain new Promise(async (resolve, reject) => {
      // This is the antipattern — async code inside new Promise constructor
      expect(source).not.toMatch(
        /new\s+Promise\s*\(\s*async\s*\(\s*resolve\s*,\s*reject\s*\)\s*=>/
      );
    });
  });
});
