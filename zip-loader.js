(() => {
  'use strict';

  const MAX_ARCHIVE = 4 * 1024 * 1024 * 1024 - 1;
  const MAX_ENTRY = 512 * 1024 * 1024;
  const MAX_ENTRIES = 10000;
  const decoder = new TextDecoder('utf-8');

  class ZipArchive {
    constructor(buffer) {
      this.bytesView = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
      this.view = new DataView(this.bytesView.buffer, this.bytesView.byteOffset, this.bytesView.byteLength);
      this.entries = [];
      this.byName = new Map();
      this.#readDirectory();
    }

    #readDirectory() {
      let eocd = -1;
      const floor = Math.max(0, this.view.byteLength - 65557);
      for (let offset = this.view.byteLength - 22; offset >= floor; offset--) {
        if (this.view.getUint32(offset, true) === 0x06054b50) { eocd = offset; break; }
      }
      if (eocd < 0) throw new Error('ไฟล์ไม่ใช่ ZIP ที่สมบูรณ์');
      const count = this.view.getUint16(eocd + 10, true);
      if (count > MAX_ENTRIES) throw new Error(`ZIP มีไฟล์มากเกินกำหนด (${count.toLocaleString()} รายการ)`);
      let offset = this.view.getUint32(eocd + 16, true);
      let expandedSize = 0;
      for (let index = 0; index < count; index++) {
        if (this.view.getUint32(offset, true) !== 0x02014b50) throw new Error('โครงสร้าง ZIP ไม่ถูกต้อง');
        const flags = this.view.getUint16(offset + 8, true);
        const method = this.view.getUint16(offset + 10, true);
        const compressedSize = this.view.getUint32(offset + 20, true);
        const size = this.view.getUint32(offset + 24, true);
        const nameLength = this.view.getUint16(offset + 28, true);
        const extraLength = this.view.getUint16(offset + 30, true);
        const commentLength = this.view.getUint16(offset + 32, true);
        const localOffset = this.view.getUint32(offset + 42, true);
        const name = decoder.decode(this.bytesView.subarray(offset + 46, offset + 46 + nameLength)).replaceAll('\\', '/');
        if (name.split('/').includes('..')) throw new Error('พบ path ที่ไม่ปลอดภัยใน ZIP');
        if (size > MAX_ENTRY) throw new Error(`ไฟล์ ${name} มีขนาดใหญ่เกินกำหนด`);
        expandedSize += size;
        if (expandedSize > MAX_ARCHIVE) throw new Error('ขนาดข้อมูลหลังแตก ZIP ใหญ่เกิน 500 MB');
        const entry = { name, flags, method, compressedSize, size, localOffset };
        this.entries.push(entry);
        this.byName.set(name, entry);
        offset += 46 + nameLength + extraLength + commentLength;
      }
    }

    async read(name) {
      const entry = typeof name === 'string' ? this.byName.get(name) : name;
      if (!entry) throw new Error(`ไม่พบ ${name} ใน ZIP`);
      if (entry.flags & 1) throw new Error(`ไม่รองรับ ZIP ที่เข้ารหัส: ${entry.name}`);
      const offset = entry.localOffset;
      if (this.view.getUint32(offset, true) !== 0x04034b50) throw new Error(`ข้อมูล ${entry.name} เสียหาย`);
      const nameLength = this.view.getUint16(offset + 26, true);
      const extraLength = this.view.getUint16(offset + 28, true);
      const start = offset + 30 + nameLength + extraLength;
      const compressed = this.bytesView.slice(start, start + entry.compressedSize);
      if (entry.method === 0) return compressed;
      if (entry.method !== 8) throw new Error(`ไม่รองรับวิธีบีบอัดของ ${entry.name}`);
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      const output = new Uint8Array(await new Response(stream).arrayBuffer());
      if (output.byteLength !== entry.size) throw new Error(`แตกไฟล์ ${entry.name} ได้ไม่ครบ`);
      return output;
    }

    async text(name) { return decoder.decode(await this.read(name)); }
  }

  class FileZipArchive {
    constructor(file, entries) {
      this.file = file;
      this.entries = entries;
      this.byName = new Map(entries.map(entry => [entry.name, entry]));
    }

    static async open(file) {
      const tailSize = Math.min(file.size, 65557);
      const tail = new Uint8Array(await file.slice(file.size - tailSize).arrayBuffer());
      const tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
      let eocd = -1;
      for (let offset = tail.byteLength - 22; offset >= 0; offset--) {
        if (tailView.getUint32(offset, true) === 0x06054b50) { eocd = offset; break; }
      }
      if (eocd < 0) throw new Error('ไฟล์ไม่ใช่ ZIP ที่สมบูรณ์');
      const count = tailView.getUint16(eocd + 10, true);
      const directorySize = tailView.getUint32(eocd + 12, true);
      const directoryOffset = tailView.getUint32(eocd + 16, true);
      if (count === 0xffff || directoryOffset === 0xffffffff) throw new Error('ยังไม่รองรับ ZIP64 ที่มีขนาดเกิน 4 GB');
      if (count > MAX_ENTRIES) throw new Error(`ZIP มีไฟล์มากเกินกำหนด (${count.toLocaleString()} รายการ)`);
      if (directorySize > 64 * 1024 * 1024) throw new Error('ZIP directory มีขนาดใหญ่ผิดปกติ');
      const directory = new Uint8Array(await file.slice(directoryOffset, directoryOffset + directorySize).arrayBuffer());
      const view = new DataView(directory.buffer, directory.byteOffset, directory.byteLength);
      const entries = [];
      let offset = 0;
      for (let index = 0; index < count; index++) {
        if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('โครงสร้าง ZIP ไม่ถูกต้อง');
        const flags = view.getUint16(offset + 8, true);
        const method = view.getUint16(offset + 10, true);
        const compressedSize = view.getUint32(offset + 20, true);
        const size = view.getUint32(offset + 24, true);
        const nameLength = view.getUint16(offset + 28, true);
        const extraLength = view.getUint16(offset + 30, true);
        const commentLength = view.getUint16(offset + 32, true);
        const localOffset = view.getUint32(offset + 42, true);
        const name = decoder.decode(directory.subarray(offset + 46, offset + 46 + nameLength)).replaceAll('\\', '/');
        if (name.split('/').includes('..')) throw new Error('พบ path ที่ไม่ปลอดภัยใน ZIP');
        entries.push({ name, flags, method, compressedSize, size, localOffset });
        offset += 46 + nameLength + extraLength + commentLength;
      }
      return new FileZipArchive(file, entries);
    }

    async read(name) {
      const entry = typeof name === 'string' ? this.byName.get(name) : name;
      if (!entry) throw new Error(`ไม่พบ ${name} ใน ZIP`);
      if (entry.flags & 1) throw new Error(`ไม่รองรับ ZIP ที่เข้ารหัส: ${entry.name}`);
      if (entry.size > MAX_ENTRY) throw new Error(`ไฟล์ ${entry.name} มีขนาดใหญ่เกิน 512 MB`);
      const headerBytes = await this.file.slice(entry.localOffset, entry.localOffset + 30).arrayBuffer();
      const header = new DataView(headerBytes);
      if (header.getUint32(0, true) !== 0x04034b50) throw new Error(`ข้อมูล ${entry.name} เสียหาย`);
      const start = entry.localOffset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
      const compressed = this.file.slice(start, start + entry.compressedSize);
      if (entry.method === 0) return new Uint8Array(await compressed.arrayBuffer());
      if (entry.method !== 8) throw new Error(`ไม่รองรับวิธีบีบอัดของ ${entry.name}`);
      const stream = compressed.stream().pipeThrough(new DecompressionStream('deflate-raw'));
      const output = new Uint8Array(await new Response(stream).arrayBuffer());
      if (output.byteLength !== entry.size) throw new Error(`แตกไฟล์ ${entry.name} ได้ไม่ครบ`);
      return output;
    }
  }

  function xml(text, name) {
    const document = new DOMParser().parseFromString(text, 'application/xml');
    if (document.querySelector('parsererror')) throw new Error(`XML ภายใน ${name} ไม่ถูกต้อง`);
    return document;
  }

  function children(node, name) {
    return [...node.children].filter(child => child.localName === name);
  }

  function cellValue(cell, shared) {
    const type = cell.getAttribute('t');
    const valueNode = children(cell, 'v')[0];
    const value = valueNode?.textContent || '';
    if (type === 's' && value !== '') return shared[Number(value)] || '';
    if (type === 'inlineStr') return children(cell, 'is')[0]?.textContent || '';
    return value;
  }

  function columnOf(reference) { return reference.match(/^[A-Z]+/)?.[0] || ''; }

  function excelTime(value) {
    if (!/^\d+(\.\d+)?$/.test(value)) return value;
    return new Date(Date.UTC(1899, 11, 30) + Number(value) * 86400000).toISOString().slice(0, 19);
  }

  function htmlText(value) {
    if (!value) return value;
    const source = value.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n');
    return new DOMParser().parseFromString(source, 'text/html').body.textContent.replace(/[ \t]+/g, ' ').replace(/(\r?\n\s*){3,}/g, '\n\n').trim();
  }

  async function parseXlsx(bytes, source) {
    const zip = new ZipArchive(bytes);
    const sharedDocument = xml(await zip.text('xl/sharedStrings.xml'), 'sharedStrings.xml');
    const shared = [...sharedDocument.getElementsByTagNameNS('*', 'si')].map(node => node.textContent);
    const workbook = xml(await zip.text('xl/workbook.xml'), 'workbook.xml');
    const relationships = xml(await zip.text('xl/_rels/workbook.xml.rels'), 'workbook.xml.rels');
    const relationshipMap = new Map([...relationships.getElementsByTagNameNS('*', 'Relationship')].map(node => [node.getAttribute('Id'), node.getAttribute('Target')]));
    const sheetMap = new Map([...workbook.getElementsByTagNameNS('*', 'sheet')].map(node => {
      const target = relationshipMap.get(node.getAttribute('r:id'));
      return [node.getAttribute('name'), target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\//, '')}`];
    }));

    const definitions = [
      ['social raw activity', 'social', 'time'],
      ['chat raw activity', 'chat', 'time'],
      ['mail raw activity', 'mail', 'time'],
      ['quiz raw activity', 'quiz', 'answer time']
    ];
    const channels = {};
    for (const [sheetName, key, timeHeader] of definitions) {
      const entry = sheetMap.get(sheetName);
      if (!entry) throw new Error(`ไม่พบชีต “${sheetName}” ใน Excel`);
      const sheet = xml(await zip.text(entry), sheetName);
      const rowNodes = [...sheet.getElementsByTagNameNS('*', 'row')];
      const headers = new Map(children(rowNodes[0], 'c').map(cell => [columnOf(cell.getAttribute('r')), cellValue(cell, shared)]));
      channels[key] = rowNodes.slice(1).map(row => {
        const record = { channel: key };
        for (const cell of children(row, 'c')) {
          const header = headers.get(columnOf(cell.getAttribute('r')));
          if (!header) continue;
          let value = cellValue(cell, shared);
          if (header === timeHeader) value = excelTime(value);
          if (header === 'message') value = htmlText(value);
          record[header] = value;
        }
        return record;
      }).filter(record => Object.keys(record).length > 1);
    }

    const keywordEntry = sheetMap.get('raw keyword');
    if (!keywordEntry) throw new Error('ไม่พบชีต “raw keyword” ใน Excel');
    const keywordSheet = xml(await zip.text(keywordEntry), 'raw keyword');
    const keywordRows = [...keywordSheet.getElementsByTagNameNS('*', 'row')];
    const schedule = keywordRows.slice(1).map(row => {
      const values = Object.fromEntries(children(row, 'c').map(cell => [columnOf(cell.getAttribute('r')), cellValue(cell, shared)]));
      return { name: values.A, minute: Number(values.B), keyword: values.C || '' };
    });
    return { source, generatedAt: new Date().toISOString(), exerciseStart: '2026-08-14T13:00:00', schedule, assets: [], channels };
  }

  function mimeType(name) {
    const extension = name.split('.').pop().toLowerCase();
    return ({
      png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp',
      pdf:'application/pdf', doc:'application/msword', docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls:'application/vnd.ms-excel', xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ppt:'application/vnd.ms-powerpoint', pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      txt:'text/plain', csv:'text/csv'
    })[extension] || 'application/octet-stream';
  }

  async function parseUpload(file) {
    if (!file.name.toLowerCase().endsWith('.zip')) throw new Error('กรุณาเลือกไฟล์ .zip');
    if (file.size > MAX_ARCHIVE) throw new Error('รองรับ ZIP32 ขนาดไม่เกิน 4 GB');
    const outer = await FileZipArchive.open(file);
    const rootOf = entry => entry.name.includes('/') ? entry.name.slice(0, entry.name.lastIndexOf('/') + 1) : '';
    const workbooks = outer.entries.filter(entry => !entry.name.startsWith('__MACOSX/') && !entry.name.split('/').pop().startsWith('~$') && entry.name.toLowerCase().endsWith('.xlsx'));
    if (!workbooks.length) throw new Error('ไม่พบไฟล์ .xlsx ภายใน ZIP');
    const workbookSets = workbooks.map(entry => {
      const prefix = `${rootOf(entry)}files/`.toLowerCase();
      return { entry, attachmentCount: outer.entries.filter(item => item.name.toLowerCase().startsWith(prefix) && !item.name.endsWith('/')).length };
    });
    const completeSets = workbookSets.filter(set => set.attachmentCount > 0);
    if (completeSets.length > 1) throw new Error('พบหลายชุด Excel + files ใน ZIP กรุณา ZIP เฉพาะโฟลเดอร์ชุดเดียว');
    const workbookEntry = (completeSets[0] || workbookSets.sort((a, b) => b.entry.size - a.entry.size)[0]).entry;
    const workbookRoot = rootOf(workbookEntry);
    const payload = await parseXlsx(await outer.read(workbookEntry), workbookEntry.name.split('/').pop());
    const needed = new Set(['social','chat','mail'].flatMap(channel => payload.channels[channel].filter(row => row.attachment).map(row => `${channel}/${row.attachment}`.toLowerCase())));
    const imagePrefix = `${workbookRoot}files/`;
    const attachments = outer.entries.filter(entry => entry.name.toLowerCase().startsWith(imagePrefix.toLowerCase()) && !entry.name.endsWith('/'));
    const loaded = new Set();
    for (const entry of attachments) {
      const relative = entry.name.slice(imagePrefix.length);
      const match = relative.match(/^(social|mail|chat)\/([^/]+)$/i);
      if (!match) continue;
      const key = `${match[1]}/${match[2]}`.toLowerCase();
      if (!needed.has(key)) continue;
      if (loaded.has(key)) throw new Error(`พบไฟล์แนบชื่อซ้ำในชุดเดียวกัน: ${match[2]}`);
      const bytes = await outer.read(entry);
      const type = mimeType(entry.name);
      payload.assets.push({ name: match[2], channel: match[1].toLowerCase(), type, path: URL.createObjectURL(new Blob([bytes], { type })) });
      loaded.add(key);
    }
    payload.missingAssets = [...needed].filter(key => !loaded.has(key));
    return payload;
  }

  function bindUpload() {
    const input = document.getElementById('zip-input');
    const button = document.getElementById('zip-button');
    const status = document.getElementById('upload-status');
    let statusTimer;
    const show = (message, type = '') => {
      clearTimeout(statusTimer);
      status.textContent = message;
      status.className = `upload-status ${type}`;
      status.hidden = false;
      if (type) statusTimer = setTimeout(() => { status.hidden = true; }, 7000);
    };
    button.addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      button.disabled = true;
      show(`กำลังอ่าน ${file.name}… ข้อมูลยังอยู่ในเครื่องนี้เท่านั้น`);
      try {
        const payload = await parseUpload(file);
        window.loadCyberdrillData(payload);
        const count = Object.values(payload.channels).reduce((sum, rows) => sum + rows.length, 0);
        const missing = payload.missingAssets.length ? ` · ไม่พบไฟล์แนบ ${payload.missingAssets.length.toLocaleString('th-TH')} ไฟล์` : '';
        show(`โหลดสำเร็จ: ${count.toLocaleString('th-TH')} กิจกรรม และ ${payload.assets.length.toLocaleString('th-TH')} ไฟล์แนบ${missing}`, payload.missingAssets.length ? 'error' : 'success');
      } catch (error) {
        show(`เปิด ZIP ไม่สำเร็จ: ${error.message}`, 'error');
        console.error(error);
      } finally {
        button.disabled = false;
        input.value = '';
      }
    });
  }

  globalThis.CyberdrillZip = { ZipArchive, FileZipArchive, parseXlsx, parseUpload };
  if (typeof document !== 'undefined') bindUpload();
  if (typeof module !== 'undefined') module.exports = { ZipArchive, FileZipArchive };
})();
