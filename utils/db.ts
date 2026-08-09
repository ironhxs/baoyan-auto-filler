export interface TextField {
  id?: number;
  key: string;
  value: string;
}

export interface BlockItem {
  fields: { key: string; value: string }[];
}

export interface BlockCategory {
  id?: number;
  title: string;
  items: BlockItem[];
  sectionId?: string;
  templateFields?: string[];
}

export interface FileRecord {
  id?: number;
  filename: string;
  fileType: string;
  fileBody: Blob;
  fileSize: number;
  fileDescription: string;
  categoryId: number;
  createdAt: number;
  _confirmDelete?: boolean;
}

export interface Category {
  id?: number;
  name: string;
  icon: string;
  sortOrder: number;
  isDefault: boolean;
  _confirmDelete?: boolean;
}

export interface AgentPlanCacheRecord {
  key: string;
  pageKey: string;
  plan: AgentPagePlan;
  createdAt: number;
  updatedAt: number;
}

const DB_NAME = 'autoFillerDB';
const DB_VERSION = 4;
let dbInstance: IDBDatabase | null = null;

const DEFAULT_CATEGORIES: Omit<Category, 'id'>[] = [
  { name: '身份证明', icon: '/icons/id-card.svg', sortOrder: 0, isDefault: false },
  { name: '学历证明', icon: '/icons/education.svg', sortOrder: 1, isDefault: false },
  { name: '资格证书', icon: '/icons/certificate.svg', sortOrder: 2, isDefault: false },
  { name: '个人照片', icon: '/icons/photo.svg', sortOrder: 3, isDefault: false },
  { name: '未分类', icon: '/icons/folder.svg', sortOrder: 99, isDefault: true },
];

function openDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = req.result;
      const oldVersion = event.oldVersion;

      if (oldVersion < 1) {
        if (!db.objectStoreNames.contains('textFields')) {
          db.createObjectStore('textFields', { keyPath: 'id', autoIncrement: true });
        }
      }
      if (oldVersion < 2) {
        if (!db.objectStoreNames.contains('fileRecords')) {
          const store = db.createObjectStore('fileRecords', { keyPath: 'id', autoIncrement: true });
          store.createIndex('fileType', 'fileType', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('blockCategories')) {
          db.createObjectStore('blockCategories', { keyPath: 'id', autoIncrement: true });
        }
      }
      if (oldVersion < 3) {
        const catStore = db.createObjectStore('categories', { keyPath: 'id', autoIncrement: true });
        catStore.createIndex('sortOrder', 'sortOrder', { unique: false });

        if (db.objectStoreNames.contains('fileRecords')) {
          const fileStore = req.transaction!.objectStore('fileRecords');
          if (!fileStore.indexNames.contains('categoryId')) {
            fileStore.createIndex('categoryId', 'categoryId', { unique: false });
          }
        }

        const uncategorizedId = DEFAULT_CATEGORIES.findIndex(c => c.isDefault);
        const uncategorized = DEFAULT_CATEGORIES[uncategorizedId];
        const catAddReq = catStore.add(uncategorized);
        catAddReq.onsuccess = () => {
          const uncId = catAddReq.result as number;
          DEFAULT_CATEGORIES.forEach((cat, i) => {
            if (i !== uncategorizedId) catStore.add(cat);
          });
          if (db.objectStoreNames.contains('fileRecords')) {
            const fileStore = req.transaction!.objectStore('fileRecords');
            const cursorReq = fileStore.openCursor();
            cursorReq.onsuccess = () => {
              const cursor = cursorReq.result;
              if (cursor) {
                const record = cursor.value;
                if (!record.categoryId) {
                  record.categoryId = uncId;
                  cursor.update(record);
                }
                cursor.continue();
              }
            };
          }
        };
      }
      if (oldVersion < 4 && !db.objectStoreNames.contains('agentPlans')) {
        const agentStore = db.createObjectStore('agentPlans', { keyPath: 'key' });
        agentStore.createIndex('pageKey', 'pageKey', { unique: false });
        agentStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };
    req.onsuccess = () => {
      dbInstance = req.result;
      dbInstance!.onclose = () => { dbInstance = null; };
      dbInstance!.onversionchange = () => { dbInstance?.close(); dbInstance = null; };
      resolve(dbInstance!);
    };
    req.onerror = () => reject(req.error);
  });
}

// ── Text Fields ──

export async function getAllTextFields(): Promise<TextField[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('textFields', 'readonly');
    const req = tx.objectStore('textFields').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function hasTextFields(): Promise<boolean> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('textFields', 'readonly');
    const req = tx.objectStore('textFields').count();
    req.onsuccess = () => resolve(req.result > 0);
    req.onerror = () => reject(req.error);
  });
}

export async function saveAllTextFields(fields: { key: string; value: string }[]): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('textFields', 'readwrite');
    const store = tx.objectStore('textFields');
    store.clear();
    for (const f of fields) {
      if (f.key.trim()) {
        store.add({ key: f.key.trim(), value: f.value });
      }
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── File Records ──

export async function getAllFileRecords(): Promise<FileRecord[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('fileRecords', 'readonly');
    const req = tx.objectStore('fileRecords').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getFileRecordsByCategory(categoryId: number): Promise<FileRecord[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('fileRecords', 'readonly');
    const store = tx.objectStore('fileRecords');
    const index = store.index('categoryId');
    const req = index.getAll(categoryId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function addFileRecord(record: Omit<FileRecord, 'id'>): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('fileRecords', 'readwrite');
    const req = tx.objectStore('fileRecords').add(record);
    req.onsuccess = () => resolve(req.result as number);
    req.onerror = () => reject(req.error);
  });
}

export async function updateFileRecord(record: FileRecord): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('fileRecords', 'readwrite');
    const req = tx.objectStore('fileRecords').put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function deleteFileRecord(id: number): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('fileRecords', 'readwrite');
    const req = tx.objectStore('fileRecords').delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function moveFileRecordsToCategory(fromCategoryId: number, toCategoryId: number): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('fileRecords', 'readwrite');
    const store = tx.objectStore('fileRecords');
    const index = store.index('categoryId');
    const req = index.openCursor(fromCategoryId);
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        const record = cursor.value;
        record.categoryId = toCategoryId;
        cursor.update(record);
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── Block Categories ──

export async function getAllBlockCategories(): Promise<BlockCategory[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('blockCategories', 'readonly');
    const req = tx.objectStore('blockCategories').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveBlockCategory(category: BlockCategory): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('blockCategories', 'readwrite');
    const store = tx.objectStore('blockCategories');
    let req: IDBRequest;
    if (category.id != null) {
      req = store.put(category);
    } else {
      req = store.add(category);
    }
    req.onsuccess = () => resolve(req.result as number);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteBlockCategory(id: number): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('blockCategories', 'readwrite');
    const req = tx.objectStore('blockCategories').delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function ensureProfileBlocksSeeded(): Promise<BlockCategory[]> {
  const { DEFAULT_REPEAT_SECTIONS, getSectionFieldKeys, getOptionalSectionFieldKeys } = await import('./profile-schema');
  const blocks = await getAllBlockCategories();

  const legacyIds = new Set(['experience', 'academic', 'awards']);
  const legacyTitles = new Set(['学习和工作经历', '学术成果', '奖励情况']);
  const legacyBlocks = blocks.filter((block) =>
    (block.sectionId && legacyIds.has(block.sectionId)) ||
    (!block.sectionId && legacyTitles.has(block.title)),
  );
  for (const block of legacyBlocks) {
    if (block.id != null) await deleteBlockCategory(block.id);
  }

  const activeBlocks = blocks.filter((block) => !legacyBlocks.includes(block));

  for (const section of DEFAULT_REPEAT_SECTIONS) {
    const existing = activeBlocks.find((block) => block.sectionId === section.id || block.title === section.title);
    const templateFields = [
      ...getSectionFieldKeys(section.id),
      ...getOptionalSectionFieldKeys(section.id),
    ];
    if (existing) {
      const needsUpdate = existing.sectionId !== section.id ||
        existing.title !== section.title ||
        JSON.stringify(existing.templateFields ?? []) !== JSON.stringify(templateFields);
      if (needsUpdate) {
        existing.title = section.title;
        existing.sectionId = section.id;
        existing.templateFields = templateFields;
        await saveBlockCategory(existing);
      }
      continue;
    }

    const block: BlockCategory = {
      title: section.title,
      sectionId: section.id,
      templateFields,
      items: [],
    };
    block.id = await saveBlockCategory(block);
    activeBlocks.push(block);
  }

  return activeBlocks;
}

// ── Categories ──

export async function getAllCategories(): Promise<Category[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('categories', 'readonly');
    const req = tx.objectStore('categories').getAll();
    req.onsuccess = () => {
      const cats = req.result as Category[];
      cats.sort((a, b) => a.sortOrder - b.sortOrder);
      resolve(cats);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function addCategory(category: Omit<Category, 'id'>): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('categories', 'readwrite');
    const req = tx.objectStore('categories').add(category);
    req.onsuccess = () => resolve(req.result as number);
    req.onerror = () => reject(req.error);
  });
}

export async function updateCategory(category: Category): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('categories', 'readwrite');
    const req = tx.objectStore('categories').put(category);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function deleteCategory(id: number): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('categories', 'readwrite');
    const req = tx.objectStore('categories').delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getCategoryCount(): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('categories', 'readonly');
    const req = tx.objectStore('categories').count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getUncategorizedId(): Promise<number | null> {
  const cats = await getAllCategories();
  const unc = cats.find(c => c.isDefault);
  return unc?.id ?? null;
}

export async function ensureCategoriesSeeded(): Promise<void> {
  const count = await getCategoryCount();
  if (count > 0) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('categories', 'readwrite');
    const store = tx.objectStore('categories');
    for (const cat of DEFAULT_CATEGORIES) {
      store.add(cat);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── Agent page plan cache ──

export async function getAgentPlanCacheRecord(key: string): Promise<AgentPlanCacheRecord | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('agentPlans', 'readonly');
    const req = tx.objectStore('agentPlans').get(key);
    req.onsuccess = () => resolve((req.result as AgentPlanCacheRecord | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveAgentPlanCacheRecord(record: AgentPlanCacheRecord): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('agentPlans', 'readwrite');
    tx.objectStore('agentPlans').put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteAgentPlanCacheRecord(key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('agentPlans', 'readwrite');
    tx.objectStore('agentPlans').delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
import type { AgentPagePlan } from './agent/types';
