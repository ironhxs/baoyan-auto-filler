import { getApiConfig, setApiConfig } from '../../utils/storage';
import type { ApiConfig, ApiMode } from '../../utils/storage';
import { matchFields } from '../../utils/matcher';
import {
  getAllTextFields, saveAllTextFields, getAllBlockCategories, saveBlockCategory, deleteBlockCategory,
  ensureProfileBlocksSeeded,
  getAllCategories, addCategory, updateCategory, deleteCategory,
  getAllFileRecords, getFileRecordsByCategory, addFileRecord, updateFileRecord, deleteFileRecord,
  moveFileRecordsToCategory, getUncategorizedId, ensureCategoriesSeeded,
} from '../../utils/db';
import type { TextField, BlockCategory, BlockItem, Category, FileRecord } from '../../utils/db';
import { DEFAULT_REPEAT_SECTIONS, PROFILE_SECTIONS, getBlockSection, getFlatSectionId } from '../../utils/profile-schema';
import { PROVIDER_PRESETS, getProviderById } from '../../utils/providers';
import { mergeFilesToPdf, type MergeFileItem } from '../../utils/pdf-merge';
import {
  appendProfileFields,
  appendProfileBlocks,
  mergeProfileFields,
  mergeProfileBlocks,
  parseProfileImportBundle,
  stringifyProfileExport,
  type ProfileFieldData,
} from '../../utils/profile-data';

const navItems = document.querySelectorAll<HTMLElement>('.nav-item');
const pageContent = document.getElementById('pageContent')!;
const pageTitle = document.getElementById('pageTitle')!;
const pageSubtitle = document.getElementById('pageSubtitle')!;

const PRESET_FIELDS: { key: string; label: string }[] = [
  { key: '姓名', label: '姓名' },
  { key: '手机号', label: '手机号' },
  { key: '邮箱', label: '邮箱' },
  { key: '住址', label: '住址' },
  { key: '性别', label: '性别' },
  { key: '民族', label: '民族' },
  { key: '政治面貌', label: '政治面貌' },
  { key: '出生地', label: '出生地' },
  { key: '籍贯地', label: '籍贯地' },
  { key: '户口所在地详细地址', label: '户口所在地详细地址' },
  { key: '档案所在单位', label: '档案所在单位' },
  { key: '档案所在单位地址', label: '档案所在单位地址' },
  { key: '档案所在单位邮政编码', label: '档案所在单位邮政编码' },
  { key: '通讯地址', label: '通讯地址' },
  { key: '通信地址邮政编码', label: '通信地址邮政编码' },
  { key: '婚否', label: '婚否' },
  { key: '现役军人码', label: '现役军人码' },
  { key: '身份证号码', label: '身份证号码' },
  { key: '出生日期', label: '出生日期' },
  { key: '紧急电话', label: '紧急电话' },
  { key: '院系', label: '院系' },
  { key: '学校', label: '学校' },
  { key: '专业', label: '专业' },
  { key: '入学年月', label: '入学年月' },
  { key: '预计毕业年月', label: '预计毕业年月' },
  { key: '外语考试成绩', label: '外语考试成绩' },
  { key: '英语四级成绩', label: '英语四级 / CET-4 成绩' },
  { key: '英语六级成绩', label: '英语六级 / CET-6 成绩' },
  { key: '综合排名', label: '综合排名' },
  { key: '成绩排名', label: '成绩排名' },
  { key: '排名基数', label: '排名基数 / 年级总人数' },
  { key: 'GPA', label: 'GPA' },
  { key: '预计能否获得推免资格', label: '预计能否获得推免资格' },
  { key: '学号', label: '学号' },
  { key: '是否来自拔尖人才培养基地', label: '是否来自拔尖人才培养基地' },
  { key: '拔尖人才培养基地名称', label: '拔尖人才培养基地名称' },
];
const PROFILE_TEMPLATE_FIELDS = PRESET_FIELDS.map(({ key }) => ({ key, value: '' }));

const PAGE_CONFIG: Record<string, { title: string; subtitle: string }> = {
  home: { title: '首页', subtitle: '概览与快捷入口' },
  profile: { title: '首页', subtitle: '' },
  certificates: { title: '证书材料', subtitle: '管理与维护您的证书和证明材料' },
  pdf: { title: '按顺序生成 PDF', subtitle: '将证明材料按指定顺序排列，生成完整申请材料 PDF' },
  settings: { title: '设置', subtitle: '个人信息、API 配置与账户设置' },
};

let currentPage = 'profile';
let profileImportMode: 'merge' | 'append' = 'merge';
let textFields: TextField[] = [];
let blockCategories: BlockCategory[] = [];
let categories: Category[] = [];
let fileRecords: FileRecord[] = [];
let selectedCategoryId: number | null = null;
let certViewMode: 'grid' | 'list' = 'list';
let apiConfigData: ApiConfig | null = null;
let nextFieldId = 0;
let pdfMergeQueue: { fileRecordId: number; name: string; type: string }[] = [];

// ===== Navigation =====
navItems.forEach((item) => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    const page = item.dataset.page!;
    switchPage(page);
  });
});

function switchPage(page: string) {
  currentPage = page;
  navItems.forEach((item) => {
    item.classList.toggle('active', item.dataset.page === page);
  });

  const config = PAGE_CONFIG[page];
  pageTitle.textContent = config.title;
  pageSubtitle.textContent = config.subtitle;

  if (page === 'profile') {
    renderProfilePage();
  } else if (page === 'settings') {
    renderSettingsPage();
  } else if (page === 'certificates') {
    renderCertificatesPage();
  } else if (page === 'pdf') {
    renderPdfPage();
  } else {
    renderPlaceholderPage(config.title);
  }
}

function renderPlaceholderPage(title: string) {
  pageContent.innerHTML = `
    <div class="placeholder-page">
      <div class="icon">🚧</div>
      <h2>${title}</h2>
      <p>该功能正在开发中，敬请期待</p>
    </div>
  `;
}

const PDF_ACCEPT_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf']);

function renderPdfPage() {
  const itemsHtml = pdfMergeQueue.map((item, idx) => {
    const isImage = item.type !== 'application/pdf';
    const icon = isImage ? '🖼' : '📄';
    const file = fileRecords.find(f => f.id === item.fileRecordId);
    const thumbHtml = (isImage && file)
      ? `<img src="${URL.createObjectURL(file.fileBody)}" alt="" class="pdf-queue-thumb-img" />`
      : `<span class="pdf-queue-thumb-icon">${icon}</span>`;
    return `
      <div class="pdf-queue-item" data-idx="${idx}" draggable="true">
        <div class="pdf-queue-drag-handle">☰</div>
        <div class="pdf-queue-thumb">${thumbHtml}</div>
        <div class="pdf-queue-name">${escapeHtml(item.name)}</div>
        <button class="pdf-queue-remove" data-idx="${idx}" title="移除">×</button>
      </div>
    `;
  }).join('');

  const emptyHtml = pdfMergeQueue.length === 0
    ? '<div class="pdf-queue-empty">暂无文件，请从下方添加</div>'
    : '';

  pageContent.innerHTML = `
    <div class="pdf-page">
      <div class="pdf-filename-row">
        <label for="pdfFilename">文件名</label>
        <input type="text" id="pdfFilename" class="pdf-filename-input" placeholder="输入合成后的 PDF 文件名" value="合并文档" />
        <span class="pdf-filename-ext">.pdf</span>
      </div>
      <div class="pdf-queue" id="pdfQueue">
        ${itemsHtml}${emptyHtml}
      </div>
      <div class="pdf-actions">
        <button class="pdf-btn-secondary" id="pdfPickFromRecords">+ 从证明材料选取</button>
        <button class="pdf-btn-secondary" id="pdfUploadLocal">+ 本地上传</button>
        <button class="pdf-btn-primary${pdfMergeQueue.length === 0 ? ' disabled' : ''}" id="pdfMergeBtn" ${pdfMergeQueue.length === 0 ? 'disabled' : ''}>合成 PDF</button>
      </div>
      <div class="pdf-hint">本地上传的文件/合成的PDF将自动保存到证明材料（未分类）</div>
    </div>
  `;

  bindPdfPageEvents();
}

function bindPdfPageEvents() {
  const queue = document.getElementById('pdfQueue')!;
  let dragSrcIdx: number | null = null;

  queue.querySelectorAll<HTMLElement>('.pdf-queue-item').forEach(item => {
    item.addEventListener('dragstart', (e) => {
      dragSrcIdx = Number(item.dataset.idx);
      item.classList.add('dragging');
      (e as DragEvent).dataTransfer?.setData('text/plain', String(dragSrcIdx));
      (e as DragEvent).dataTransfer!.effectAllowed = 'move';
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      queue.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
      dragSrcIdx = null;
    });
    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      (e as DragEvent).dataTransfer!.dropEffect = 'move';
      const target = (e.target as HTMLElement).closest('.pdf-queue-item') as HTMLElement | null;
      if (target && target !== item) {
        target.classList.add('drag-over');
      }
    });
    item.addEventListener('dragleave', (e) => {
      const target = (e.target as HTMLElement).closest('.pdf-queue-item') as HTMLElement | null;
      if (target) target.classList.remove('drag-over');
    });
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      const target = (e.target as HTMLElement).closest('.pdf-queue-item') as HTMLElement | null;
      if (!target || dragSrcIdx === null) return;
      const dropIdx = Number(target.dataset.idx);
      if (dropIdx === dragSrcIdx) return;
      const [moved] = pdfMergeQueue.splice(dragSrcIdx, 1);
      pdfMergeQueue.splice(dropIdx, 0, moved);
      renderPdfPage();
    });
  });

  queue.querySelectorAll<HTMLButtonElement>('.pdf-queue-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.idx);
      pdfMergeQueue.splice(idx, 1);
      renderPdfPage();
    });
  });

  document.getElementById('pdfPickFromRecords')?.addEventListener('click', () => {
    showPdfFilePickerModal();
  });

  document.getElementById('pdfUploadLocal')?.addEventListener('click', async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.jpg,.jpeg,.png,.webp,.pdf';
    input.style.display = 'none';
    document.body.appendChild(input);

    input.addEventListener('change', async () => {
      const files = Array.from(input.files ?? []);
      const uncId = await getUncategorizedId();
      if (!uncId) { input.remove(); return; }

      for (const file of files) {
        if (!PDF_ACCEPT_TYPES.has(file.type)) continue;
        const id = await addFileRecord({
          filename: file.name,
          fileType: file.type,
          fileBody: file,
          fileSize: file.size,
          fileDescription: '',
          categoryId: uncId,
          createdAt: Date.now(),
        });
        fileRecords = await getAllFileRecords();
        pdfMergeQueue.push({ fileRecordId: id, name: file.name, type: file.type });
      }
      input.remove();
      renderPdfPage();
    });

    input.click();
  });

  document.getElementById('pdfMergeBtn')?.addEventListener('click', async () => {
    if (pdfMergeQueue.length === 0) return;
    const btn = document.getElementById('pdfMergeBtn') as HTMLButtonElement;
    btn.textContent = '合成中...';
    btn.disabled = true;

    try {
      const mergeItems: MergeFileItem[] = [];
      for (const q of pdfMergeQueue) {
        const file = fileRecords.find(f => f.id === q.fileRecordId);
        if (!file) continue;
        const buf = await file.fileBody.arrayBuffer();
        mergeItems.push({
          name: file.filename,
          type: file.fileType === 'application/pdf' ? 'pdf' : 'image',
          data: buf,
        });
      }

      const pdfBytes = await mergeFilesToPdf(mergeItems);
      const pdfBlob = new Blob([new Uint8Array(pdfBytes) as BlobPart], { type: 'application/pdf' });

      const filenameInput = document.getElementById('pdfFilename') as HTMLInputElement;
      const filename = (filenameInput.value.trim() || '合并文档') + '.pdf';
      const uncId = await getUncategorizedId();
      await addFileRecord({
        filename,
        fileType: 'application/pdf',
        fileBody: pdfBlob,
        fileSize: pdfBlob.size,
        fileDescription: '',
        categoryId: uncId ?? 0,
        createdAt: Date.now(),
      });
      fileRecords = await getAllFileRecords();

      pdfMergeQueue = [];
      renderPdfPage();

      const hint = document.querySelector('.pdf-hint');
      if (hint) hint.textContent = `已保存到证明材料：${filename}（可在证书材料中下载）`;
    } catch (err) {
      console.error('PDF merge failed:', err);
      alert('PDF 合成失败，请检查文件格式');
      btn.textContent = '合成 PDF';
      btn.disabled = false;
    }
  });
}

function showPdfFilePickerModal() {
  const eligibleFiles = fileRecords.filter(f => PDF_ACCEPT_TYPES.has(f.fileType));
  const itemsHtml = eligibleFiles.map(f => `
    <label class="pdf-picker-item">
      <input type="checkbox" class="pdf-picker-checkbox" data-file-id="${f.id}" />
      <span class="pdf-picker-name">${escapeHtml(f.filename)}</span>
      <span class="pdf-picker-type">${f.fileType === 'application/pdf' ? 'PDF' : '图片'}</span>
    </label>
  `).join('');

  const overlay = document.createElement('div');
  overlay.className = 'pdf-picker-overlay';
  overlay.innerHTML = `
    <div class="pdf-picker-modal">
      <div class="pdf-picker-header">
        <h3>选择文件</h3>
        <button class="pdf-picker-close" id="pdfPickerClose">×</button>
      </div>
      <div class="pdf-picker-list">${itemsHtml}</div>
      <div class="pdf-picker-footer">
        <button class="pdf-btn-secondary" id="pdfPickerCancel">取消</button>
        <button class="pdf-btn-primary" id="pdfPickerConfirm">确认添加</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector('#pdfPickerClose')?.addEventListener('click', close);
  overlay.querySelector('#pdfPickerCancel')?.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  overlay.querySelector('#pdfPickerConfirm')?.addEventListener('click', () => {
    const checked = overlay.querySelectorAll<HTMLInputElement>('.pdf-picker-checkbox:checked');
    checked.forEach(cb => {
      const fileId = Number(cb.dataset.fileId);
      const file = fileRecords.find(f => f.id === fileId);
      if (!file || pdfMergeQueue.some(q => q.fileRecordId === fileId)) return;
      pdfMergeQueue.push({ fileRecordId: fileId, name: file.filename, type: file.fileType });
    });
    close();
    renderPdfPage();
  });
}

// ===== Profile Page =====
function renderProfilePage() {
  const fieldMap = Object.fromEntries(textFields.map((f) => [f.key, f.value]));

  const renderFlatFields = (fields: TextField[]) => fields.map((f) => `
    <div class="profile-field">
      <span class="label">${escapeHtml(f.key)}</span>
      <span class="value">${escapeHtml(f.value) || '<span class="empty">未填写</span>'}</span>
    </div>
  `).join('');

  const renderBlock = (cat: BlockCategory, extraFields: TextField[] = []) => {
    const catId = cat.id!;
    const itemsHtml = cat.items.map((item, itemIdx) => renderBlockItemHtml(item, catId, itemIdx)).join('');
    const emptyHtml = cat.items.length === 0 ? '<div class="block-empty">暂无条目，点击下方按钮添加</div>' : '';
    const section = getBlockSection(cat);
    return `
      <div class="card profile-section-card" data-section="${escapeAttr(section?.id ?? 'custom')}">
        <div class="card-header">
          <span class="card-title">${section?.icon ?? '📁'} ${escapeHtml(cat.title)}</span>
          ${cat.sectionId ? '' : `<button class="card-action block-delete-btn" data-cat-id="${catId}" title="删除此分类">删除分类</button>`}
        </div>
        ${extraFields.length ? `<div class="profile-fields section-flat-fields">${renderFlatFields(extraFields)}</div>` : ''}
        <div class="exp-list">${itemsHtml}${emptyHtml}</div>
        <button class="add-btn block-add-item-btn" data-cat-id="${catId}">+ 添加条目</button>
      </div>
    `;
  };

  const sectionCardsHtml = PROFILE_SECTIONS.map((section) => {
    const sectionFields = textFields.filter((field) => getFlatSectionId(field.key) === section.id);
    if (section.kind === 'flat') {
      return `
        <div class="card profile-section-card" data-section="${section.id}">
          <div class="card-header">
            <span class="card-title">${section.icon} ${section.title}</span>
            <button class="card-action edit-section-btn">编辑</button>
          </div>
          <div class="profile-fields">${renderFlatFields(sectionFields)}</div>
        </div>
      `;
    }

    const block = blockCategories.find((cat) => cat.sectionId === section.id || cat.title === section.title);
    return block ? renderBlock(block, section.id === 'language' ? sectionFields : []) : '';
  }).join('');

  const customFields = textFields.filter((field) => getFlatSectionId(field.key) === 'custom');
  const customFieldsHtml = customFields.length ? `
    <div class="card profile-section-card" data-section="custom">
      <div class="card-header">
        <span class="card-title">🗂 其他资料</span>
        <button class="card-action edit-section-btn">编辑</button>
      </div>
      <div class="profile-fields">${renderFlatFields(customFields)}</div>
    </div>
  ` : '';

  const customBlocksHtml = blockCategories.filter((cat) => !getBlockSection(cat)).map((cat) => renderBlock(cat)).join('');

  // Add block category button
  const addBlockHtml = `
    <button class="add-btn add-block-cat-btn" style="margin-bottom: 20px;">+ 添加分类</button>
  `;

  // Real materials from IndexedDB, grouped by category
  const recentFiles = [...fileRecords].sort((a, b) => b.createdAt - a.createdAt).slice(0, 8);
  const totalFiles = fileRecords.length;

  const materialHtml = recentFiles.length === 0
    ? `<div class="material-empty">暂无材料，点击上方按钮添加</div>`
    : recentFiles.map((f) => {
        const cat = categories.find(c => c.id === f.categoryId);
        const { icon } = getFileCategoryIcon(f.fileType);
        return `
          <div class="material-item cert-file-card-link" data-file-id="${f.id}" data-cat-id="${f.categoryId}">
            <div class="material-thumb">${IMAGE_TYPES.has(f.fileType) ? '<img class="material-thumb-img" data-file-id="' + f.id + '" src="" alt="" />' : icon}</div>
            <div class="material-info">
              <div class="material-name">${escapeHtml(f.filename)}</div>
              <span class="material-cat">${cat ? escapeHtml(cat.name) : '未分类'}</span>
            </div>
            <div class="material-arrow">›</div>
          </div>
        `;
      }).join('');

  const firstName = fieldMap['姓名']?.[0] || fieldMap['name']?.[0] || '用';

  pageContent.innerHTML = `
    <div class="profile-grid">
      <div class="profile-left">
        <div class="profile-summary-card">
          <div class="profile-avatar">${firstName}</div>
          <div>
            <div class="profile-summary-title">七类推免资料</div>
            <div class="profile-summary-subtitle">基础字段与多条经历统一管理，填充前请保持资料最新。</div>
          </div>
        </div>

        ${sectionCardsHtml}
        ${customFieldsHtml}
        ${addBlockHtml}
        ${customBlocksHtml}
      </div>

      <div class="profile-right">
        <div class="card">
          <div class="material-header">
            <div>
              <div class="card-title">材料库</div>
              <div class="material-count">共 ${totalFiles} 个材料</div>
            </div>
            <button class="upload-btn" id="goToMaterialsBtn">管理材料</button>
          </div>
          <div class="material-list">${materialHtml}</div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('editProfileBtn')?.addEventListener('click', () => {
    switchPage('settings');
  });

  document.querySelectorAll('.edit-section-btn').forEach((button) => {
    button.addEventListener('click', () => switchPage('settings'));
  });

  document.getElementById('goToMaterialsBtn')?.addEventListener('click', () => {
    switchPage('certificates');
  });

  // Load image thumbnails
  for (const f of recentFiles) {
    if (IMAGE_TYPES.has(f.fileType)) {
      const img = document.querySelector(`img.material-thumb-img[data-file-id="${f.id}"]`) as HTMLImageElement;
      if (img) img.src = URL.createObjectURL(f.fileBody);
    }
  }

  // Click material item → navigate to certificates page with that category selected
  pageContent.querySelectorAll<HTMLElement>('.cert-file-card-link').forEach(el => {
    el.addEventListener('click', () => {
      const catId = parseInt(el.dataset.catId!, 10);
      selectedCategoryId = catId;
      switchPage('certificates');
    });
  });

  bindBlockEvents();
}

// ===== Block Item Rendering =====

function renderBlockItemHtml(item: BlockItem, catId: number, itemIdx: number): string {
  const first = item.fields[0];
  const keyLabel = first ? escapeHtml(first.key) : '';
  const valueDisplay = first ? escapeHtml(first.value) || '<span class="empty">未填写</span>' : '<span class="empty">未填写</span>';
  const metaHtml = item.fields.slice(1).map(f =>
    `<span class="exp-card-meta-item">${escapeHtml(f.key)}: ${escapeHtml(f.value)}</span>`
  ).join('');

  return `
    <div class="exp-card" data-cat-id="${catId}" data-item-idx="${itemIdx}">
      <div class="exp-card-header">
        <div>
          ${keyLabel ? `<div class="exp-card-key">${keyLabel}</div>` : ''}
          <span class="exp-card-title">${valueDisplay}</span>
        </div>
        <div class="exp-card-actions">
          <button class="block-item-edit-btn" data-cat-id="${catId}" data-item-idx="${itemIdx}">编辑</button>
          <button class="block-item-delete-btn" data-cat-id="${catId}" data-item-idx="${itemIdx}">删除</button>
        </div>
      </div>
      <div class="exp-card-meta">${metaHtml}</div>
    </div>
  `;
}

function renderBlockItemEditHtml(item: BlockItem, catId: number, itemIdx: number): string {
  const rows = item.fields.length === 0
    ? [{ key: '', value: '' }]
    : item.fields;

  const fieldRowsHtml = rows.map(f =>
    `<div class="block-field-row">
      <input type="text" class="block-field-key" placeholder="字段名" value="${escapeHtml(f.key)}" />
      <input type="text" class="block-field-value" placeholder="字段值" value="${escapeHtml(f.value)}" />
      <button class="btn-delete block-field-remove-btn" title="删除字段">&times;</button>
    </div>`
  ).join('');

  return `
    <div class="exp-card block-item-edit" data-cat-id="${catId}" data-item-idx="${itemIdx}">
      <div class="block-edit-fields">${fieldRowsHtml}</div>
      <div class="block-edit-actions">
        <button class="add-btn block-add-field-btn">+ 添加字段</button>
        <button class="card-action block-edit-save-btn">保存</button>
        <button class="card-action block-edit-cancel-btn">取消</button>
      </div>
    </div>
  `;
}

async function bindBlockEvents() {
  // Add new block category — inline input
  document.querySelector('.add-block-cat-btn')?.addEventListener('click', () => {
    const btn = document.querySelector('.add-block-cat-btn')!;
    const wrapper = document.createElement('div');
    wrapper.className = 'add-block-cat-form';
    wrapper.innerHTML = `
      <input type="text" class="add-block-cat-input" placeholder="输入分类名称，如：项目经历" />
      <button class="card-action add-block-cat-confirm">添加</button>
      <button class="add-block-cat-cancel">取消</button>
    `;
    btn.replaceWith(wrapper);
    const input = wrapper.querySelector<HTMLInputElement>('.add-block-cat-input')!;
    input.focus();

    async function doAdd() {
      const title = input.value.trim();
      if (!title) { wrapper.replaceWith(btn); return; }
      const cat: BlockCategory = { title, items: [] };
      const id = await saveBlockCategory(cat);
      cat.id = id;
      blockCategories.push(cat);
      renderProfilePage();
    }

    function doCancel() {
      wrapper.replaceWith(btn);
    }

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doAdd();
      if (e.key === 'Escape') doCancel();
    });
    wrapper.querySelector('.add-block-cat-confirm')!.addEventListener('click', doAdd);
    wrapper.querySelector('.add-block-cat-cancel')!.addEventListener('click', doCancel);
  });

  // Delete block category — inline confirm
  document.querySelectorAll<HTMLButtonElement>('.block-delete-btn').forEach(btn => {
    let confirmTimer: ReturnType<typeof setTimeout> | null = null;

    btn.addEventListener('click', async () => {
      if (btn.dataset.confirming === 'true') {
        // Second click — actually delete
        if (confirmTimer) clearTimeout(confirmTimer);
        const catId = Number(btn.dataset.catId);
        await deleteBlockCategory(catId);
        blockCategories = blockCategories.filter(c => c.id !== catId);
        renderProfilePage();
        return;
      }
      // First click — enter confirm state
      btn.dataset.confirming = 'true';
      btn.textContent = '确认删除？';
      confirmTimer = setTimeout(() => {
        btn.dataset.confirming = '';
        btn.textContent = '删除分类';
      }, 3000);
    });
  });

  // Add new item to a block category
  document.querySelectorAll<HTMLButtonElement>('.block-add-item-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const catId = Number(btn.dataset.catId);
      const cat = blockCategories.find(c => c.id === catId);
      if (!cat) return;
      const newItem: BlockItem = {
        fields: cat.templateFields?.length
          ? cat.templateFields.map((key) => ({ key, value: '' }))
          : [{ key: '', value: '' }],
      };
      cat.items.push(newItem);
      renderProfilePage();
      const editCards = document.querySelectorAll<HTMLElement>('.block-item-edit');
      const last = editCards[editCards.length - 1];
      last?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      last?.querySelector<HTMLInputElement>('.block-field-key')?.focus();
    });
  });

  // Edit item
  document.querySelectorAll<HTMLButtonElement>('.block-item-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const catId = Number(btn.dataset.catId);
      const itemIdx = Number(btn.dataset.itemIdx);
      const cat = blockCategories.find(c => c.id === catId);
      if (!cat) return;
      const item = cat.items[itemIdx];
      const displayCard = btn.closest('.exp-card')!;
      const tmp = document.createElement('div');
      tmp.innerHTML = renderBlockItemEditHtml(item, catId, itemIdx);
      const editCard = tmp.firstElementChild as HTMLElement;
      displayCard.replaceWith(editCard);
      bindBlockItemEditEvents(editCard, catId, itemIdx);
    });
  });

  // Delete item — inline confirm
  document.querySelectorAll<HTMLButtonElement>('.block-item-delete-btn').forEach(btn => {
    let confirmTimer: ReturnType<typeof setTimeout> | null = null;

    btn.addEventListener('click', async () => {
      if (btn.dataset.confirming === 'true') {
        if (confirmTimer) clearTimeout(confirmTimer);
        const catId = Number(btn.dataset.catId);
        const itemIdx = Number(btn.dataset.itemIdx);
        const cat = blockCategories.find(c => c.id === catId);
        if (!cat) return;
        cat.items.splice(itemIdx, 1);
        await saveBlockCategory(cat);
        renderProfilePage();
        return;
      }
      btn.dataset.confirming = 'true';
      btn.textContent = '确认？';
      confirmTimer = setTimeout(() => {
        btn.dataset.confirming = '';
        btn.textContent = '删除';
      }, 3000);
    });
  });
}

function bindBlockItemEditEvents(editCard: HTMLElement, catId: number, itemIdx: number) {
  // Add field row
  editCard.querySelector('.block-add-field-btn')?.addEventListener('click', () => {
    const fieldsContainer = editCard.querySelector('.block-edit-fields')!;
    const row = document.createElement('div');
    row.className = 'block-field-row';
    row.innerHTML = `
      <input type="text" class="block-field-key" placeholder="字段名" value="" />
      <input type="text" class="block-field-value" placeholder="字段值" value="" />
      <button class="btn-delete block-field-remove-btn" title="删除字段">&times;</button>
    `;
    fieldsContainer.appendChild(row);
    row.querySelector<HTMLInputElement>('.block-field-key')?.focus();
    row.querySelector('.block-field-remove-btn')?.addEventListener('click', () => row.remove());
  });

  // Remove field row
  editCard.querySelectorAll('.block-field-remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = btn.closest('.block-field-row')!;
      const container = editCard.querySelector('.block-edit-fields')!;
      if (container.children.length > 1) {
        row.remove();
      }
    });
  });

  // Save
  editCard.querySelector('.block-edit-save-btn')?.addEventListener('click', async () => {
    const cat = blockCategories.find(c => c.id === catId);
    if (!cat) return;
    const rows = editCard.querySelectorAll<HTMLElement>('.block-field-row');
    const fields: { key: string; value: string }[] = [];
    rows.forEach(row => {
      const key = (row.querySelector('.block-field-key') as HTMLInputElement)?.value.trim() ?? '';
      const value = (row.querySelector('.block-field-value') as HTMLInputElement)?.value.trim() ?? '';
      if (key || value) fields.push({ key, value });
    });
    cat.items[itemIdx] = { fields };
    await saveBlockCategory(cat);
    renderProfilePage();
  });

  // Cancel
  editCard.querySelector('.block-edit-cancel-btn')?.addEventListener('click', () => {
    const cat = blockCategories.find(c => c.id === catId);
    if (!cat) return;
    // If item has no meaningful fields, remove it
    const item = cat.items[itemIdx];
    const hasContent = item.fields.some(f => f.key.trim() || f.value.trim());
    if (!hasContent) {
      cat.items.splice(itemIdx, 1);
    }
    renderProfilePage();
  });
}

// ===== Certificates Page =====

const IMAGE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const FILE_ACCEPT = '.jpg,.jpeg,.png,.webp,.pdf,.doc,.docx';

const ICON_PREVIEW = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const ICON_RENAME = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
const ICON_MOVE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
const ICON_DELETE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
const ICON_DOWNLOAD = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
}

function getFileCategoryIcon(fileType: string): { cls: string; icon: string } {
  if (fileType === 'application/pdf') return { cls: 'pdf', icon: '📄' };
  if (fileType.includes('word') || fileType.includes('document')) return { cls: 'doc', icon: '📝' };
  return { cls: 'other', icon: '📎' };
}

function renderCertificatesPage() {
  if (categories.length === 0 || selectedCategoryId === null) {
    const unc = categories.find(c => c.isDefault);
    selectedCategoryId = unc?.id ?? null;
  }

  const catHtml = renderCatSidebar();
  const fileHtml = renderCertFilePanel();

  pageContent.innerHTML = `
    <div class="cert-layout">
      <div class="cert-sidebar">
        <div class="cert-sidebar-title">分类管理</div>
        <div class="cert-cat-list">${catHtml}</div>
        <div class="cert-sidebar-footer">
          <button class="cert-add-cat-btn" id="certAddCatBtn">+ 新增分类</button>
        </div>
      </div>
      <div class="cert-main">
        <div class="cert-toolbar">
          <input type="text" class="cert-search" placeholder="搜索文件名..." id="certSearch" />
          <div class="cert-toolbar-right">
            <button class="cert-view-toggle" id="certViewToggle" title="${certViewMode === 'grid' ? '切换到列表视图' : '切换到卡片视图'}">
              ${certViewMode === 'grid'
                ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>'
                : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>'}
            </button>
            <button class="cert-upload-btn" id="certUploadBtn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
              上传材料
            </button>
          </div>
        </div>
        <div class="cert-file-grid cert-view-${certViewMode}" id="certFileGrid">${fileHtml}</div>
      </div>
    </div>
  `;

  bindCertEvents();
}

function renderCatSidebar(): string {
  return categories.map(cat => {
    const count = fileRecords.filter(f => f.categoryId === cat.id).length;
    const active = cat.id === selectedCategoryId ? ' active' : '';
    const confirmClass = cat._confirmDelete ? ' confirm-delete' : '';
    return `
      <div class="cert-cat-item${active}" data-cat-id="${cat.id}">
        <div class="cert-cat-icon"><img src="${escapeAttr(cat.icon)}" alt="" /></div>
        <div class="cert-cat-info">
          <div class="cert-cat-name" style="${cat._confirmDelete ? 'color:#EF4444' : ''}">${escapeHtml(cat._confirmDelete ? '确认删除？' : cat.name)}</div>
          <div class="cert-cat-count">${count} 个文件</div>
        </div>
        <div class="cert-cat-actions">
          ${!cat.isDefault ? `
            <button class="cert-cat-action-btn rename" title="重命名">${ICON_RENAME}</button>
            <button class="cert-cat-action-btn delete${confirmClass}" data-cat-id="${cat.id}" title="删除">${cat._confirmDelete ? '确认' : ICON_DELETE}</button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function renderCertFilePanel(): string {
  const catFiles = fileRecords.filter(f => f.categoryId === selectedCategoryId);
  if (catFiles.length === 0) {
    return `
      <div class="cert-empty">
        <div class="cert-empty-icon">📂</div>
        <div class="cert-empty-text">该分类下暂无文件</div>
        <button class="cert-empty-upload-btn" id="certEmptyUpload">上传文件到此分类</button>
      </div>
    `;
  }

  return catFiles.map(f => renderFileCardHtml(f)).join('');
}

function renderFileCardHtml(f: FileRecord): string {
  const isImage = IMAGE_TYPES.has(f.fileType);
  const { cls, icon } = getFileCategoryIcon(f.fileType);

  const confirmHtml = f._confirmDelete
    ? `<button class="cert-file-action-btn delete confirm-delete" data-file-id="${f.id}">确认?</button>`
    : `<button class="cert-file-action-btn delete" data-file-id="${f.id}" title="删除">${ICON_DELETE}</button>`;

  const actionsHtml = `
    <div class="cert-file-actions">
      <button class="cert-file-action-btn preview" data-file-id="${f.id}" title="预览">${ICON_PREVIEW}</button>
      <button class="cert-file-action-btn rename" data-file-id="${f.id}" title="重命名">${ICON_RENAME}</button>
      <button class="cert-file-action-btn move" data-file-id="${f.id}" title="移动">${ICON_MOVE}</button>
      <button class="cert-file-action-btn download" data-file-id="${f.id}" title="下载">${ICON_DOWNLOAD}</button>
      ${confirmHtml}
    </div>
  `;

  if (certViewMode === 'list') {
    const thumbHtml = isImage
      ? `<div class="cert-file-thumb cert-file-thumb-sm"><img src="" data-file-id="${f.id}" alt="${escapeAttr(f.filename)}" /></div>`
      : `<div class="cert-file-thumb cert-file-thumb-sm"><span class="cert-file-thumb-icon ${cls}">${icon}</span></div>`;
    return `
      <div class="cert-file-card cert-file-list-row" data-file-id="${f.id}">
        ${thumbHtml}
        <div class="cert-file-info cert-file-info-list">
          <div class="cert-file-name" title="${escapeAttr(f.filename)}">${escapeHtml(f.filename)}</div>
          <div class="cert-file-meta-list">
            <span>${formatFileSize(f.fileSize)}</span>
            <span>${f.fileType}</span>
          </div>
        </div>
        ${actionsHtml}
      </div>
    `;
  }

  const thumbHtml = isImage
    ? `<div class="cert-file-thumb"><img src="" data-file-id="${f.id}" alt="${escapeAttr(f.filename)}" /></div>`
    : `<div class="cert-file-thumb"><span class="cert-file-thumb-icon ${cls}">${icon}</span></div>`;
  return `
    <div class="cert-file-card" data-file-id="${f.id}">
      ${thumbHtml}
      <div class="cert-file-info">
        <div class="cert-file-name" title="${escapeAttr(f.filename)}">${escapeHtml(f.filename)}</div>
        <div class="cert-file-size">${formatFileSize(f.fileSize)}</div>
      </div>
      <div class="cert-file-actions">
        <button class="cert-file-action-btn preview" data-file-id="${f.id}" title="预览">${ICON_PREVIEW}</button>
        <button class="cert-file-action-btn rename" data-file-id="${f.id}" title="重命名">${ICON_RENAME}</button>
        <button class="cert-file-action-btn move" data-file-id="${f.id}" title="移动">${ICON_MOVE}</button>
        <button class="cert-file-action-btn download" data-file-id="${f.id}" title="下载">${ICON_DOWNLOAD}</button>
        ${confirmHtml}
      </div>
    </div>
  `;
}

function bindCertEvents() {
  // Load image thumbnails via blob URLs
  const catFiles = fileRecords.filter(f => f.categoryId === selectedCategoryId);
  for (const f of catFiles) {
    if (IMAGE_TYPES.has(f.fileType)) {
      const img = document.querySelector(`img[data-file-id="${f.id}"]`) as HTMLImageElement;
      if (img) {
        const url = URL.createObjectURL(f.fileBody);
        img.src = url;
      }
    }
  }

  // Search
  document.getElementById('certSearch')?.addEventListener('input', (e) => {
    const query = (e.target as HTMLInputElement).value.trim().toLowerCase();
    const grid = document.getElementById('certFileGrid')!;
    const cards = grid.querySelectorAll<HTMLElement>('.cert-file-card');
    cards.forEach(card => {
      const name = card.querySelector('.cert-file-name')?.textContent ?? '';
      card.style.display = (!query || name.toLowerCase().includes(query)) ? '' : 'none';
    });
  });

  // Upload
  const uploadInput = document.createElement('input');
  uploadInput.type = 'file';
  uploadInput.multiple = true;
  uploadInput.accept = FILE_ACCEPT;
  uploadInput.style.display = 'none';
  document.body.appendChild(uploadInput);

  let uploadResolve: ((files: File[]) => void) | null = null;
  uploadInput.addEventListener('change', () => {
    const files = Array.from(uploadInput.files ?? []);
    if (uploadResolve) uploadResolve(files);
    uploadInput.value = '';
  });

  function triggerUpload(): Promise<File[]> {
    return new Promise(resolve => {
      uploadResolve = resolve;
      uploadInput.click();
    });
  }

  async function doUpload(files: File[]) {
    if (files.length === 0 || selectedCategoryId === null) return;
    for (const file of files) {
      await addFileRecord({
        filename: file.name,
        fileType: file.type,
        fileBody: file,
        fileSize: file.size,
        fileDescription: '',
        categoryId: selectedCategoryId,
        createdAt: Date.now(),
      });
    }
    fileRecords = await getAllFileRecords();
    renderCertificatesPage();
    // Scroll to last card
    const grid = document.getElementById('certFileGrid');
    const lastCard = grid?.lastElementChild as HTMLElement;
    lastCard?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // View toggle
  document.getElementById('certViewToggle')?.addEventListener('click', () => {
    certViewMode = certViewMode === 'grid' ? 'list' : 'grid';
    renderCertificatesPage();
  });

  document.getElementById('certUploadBtn')?.addEventListener('click', async () => {
    const files = await triggerUpload();
    await doUpload(files);
  });

  document.getElementById('certEmptyUpload')?.addEventListener('click', async () => {
    const files = await triggerUpload();
    await doUpload(files);
  });

  // Category click
  document.querySelectorAll<HTMLElement>('.cert-cat-item').forEach(item => {
    item.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('.cert-cat-action-btn')) return;
      const catId = Number(item.dataset.catId);
      selectedCategoryId = catId;
      renderCertificatesPage();
    });
  });

  // Category rename
  document.querySelectorAll<HTMLButtonElement>('.cert-cat-action-btn.rename').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = btn.closest('.cert-cat-item') as HTMLElement;
      const catId = Number(item.dataset.catId);
      const cat = categories.find(c => c.id === catId);
      if (!cat) return;

      const nameEl = item.querySelector('.cert-cat-name')!;
      const original = cat.name;
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'cert-cat-rename-input';
      input.value = original;
      nameEl.replaceWith(input);
      input.focus();
      input.select();

      async function doRename() {
        const newName = input.value.trim();
        if (newName && newName !== original && cat) {
          cat.name = newName;
          await updateCategory(cat);
        }
        renderCertificatesPage();
      }

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doRename();
        if (e.key === 'Escape') renderCertificatesPage();
      });
      input.addEventListener('blur', doRename);
    });
  });

  // Category delete
  document.querySelectorAll<HTMLButtonElement>('.cert-cat-action-btn.delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const catId = Number(btn.dataset.catId);
      const cat = categories.find(c => c.id === catId);
      if (!cat || cat.isDefault) return;

      if (cat._confirmDelete) {
        delete cat._confirmDelete;
        const uncId = await getUncategorizedId();
        await moveFileRecordsToCategory(catId, uncId!);
        await deleteCategory(catId);
        categories = categories.filter(c => c.id !== catId);
        selectedCategoryId = uncId;
        renderCertificatesPage();
      } else {
        cat._confirmDelete = true;
        renderCertificatesPage();
        setTimeout(() => {
          if (cat._confirmDelete) {
            cat._confirmDelete = false;
            renderCertificatesPage();
          }
        }, 3000);
      }
    });
  });

  // Add category
  document.getElementById('certAddCatBtn')?.addEventListener('click', () => {
    const footer = document.querySelector('.cert-sidebar-footer')!;
    const btn = document.getElementById('certAddCatBtn')!;
    const form = document.createElement('div');
    form.className = 'cert-add-cat-form';
    form.innerHTML = `
      <input type="text" placeholder="输入分类名称" />
      <button class="confirm">确定</button>
      <button class="cancel">取消</button>
    `;
    btn.replaceWith(form);
    const input = form.querySelector<HTMLInputElement>('input')!;
    input.focus();

    async function doAdd() {
      const name = input.value.trim();
      if (!name) { renderCertificatesPage(); return; }
      const maxOrder = categories.reduce((m, c) => Math.max(m, c.sortOrder), 0);
      const id = await addCategory({
        name,
        icon: '/icons/folder.svg',
        sortOrder: maxOrder + 1,
        isDefault: false,
      });
      categories.push({ id, name, icon: '/icons/folder.svg', sortOrder: maxOrder + 1, isDefault: false });
      selectedCategoryId = id;
      renderCertificatesPage();
    }

    function doCancel() {
      renderCertificatesPage();
    }

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doAdd();
      if (e.key === 'Escape') doCancel();
    });
    form.querySelector('.confirm')!.addEventListener('click', doAdd);
    form.querySelector('.cancel')!.addEventListener('click', doCancel);
  });

  // File preview
  document.querySelectorAll<HTMLButtonElement>('.cert-file-action-btn.preview').forEach(btn => {
    btn.addEventListener('click', () => {
      const fileId = Number(btn.dataset.fileId);
      const file = fileRecords.find(f => f.id === fileId);
      if (!file) return;
      showPreviewModal(file);
    });
  });

  // File rename
  document.querySelectorAll<HTMLButtonElement>('.cert-file-action-btn.rename').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const fileId = Number(btn.dataset.fileId);
      const file = fileRecords.find(f => f.id === fileId);
      if (!file) return;

      const card = btn.closest('.cert-file-card')!;
      const nameEl = card.querySelector('.cert-file-name') as HTMLElement;
      const original = file.filename;
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'cert-file-rename-input';
      input.value = original;
      nameEl.replaceWith(input);
      input.focus();

      // Select name without extension
      const dotIdx = original.lastIndexOf('.');
      input.setSelectionRange(0, dotIdx > 0 ? dotIdx : original.length);

      async function doRename() {
        const newName = input.value.trim();
        if (newName && newName !== original && file) {
          file.filename = newName;
          await updateFileRecord(file);
          fileRecords = fileRecords.map(f => f.id === file.id ? file : f);
        }
        renderCertificatesPage();
      }

      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') doRename();
        if (ev.key === 'Escape') renderCertificatesPage();
      });
      input.addEventListener('blur', doRename);
    });
  });

  // File download
  document.querySelectorAll<HTMLButtonElement>('.cert-file-action-btn.download').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const fileId = Number(btn.dataset.fileId);
      const file = fileRecords.find(f => f.id === fileId);
      if (!file) return;
      const url = URL.createObjectURL(file.fileBody);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    });
  });

  // File move
  document.querySelectorAll<HTMLButtonElement>('.cert-file-action-btn.move').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const fileId = Number(btn.dataset.fileId);
      const file = fileRecords.find(f => f.id === fileId);
      if (!file) return;

      // Remove existing dropdowns
      document.querySelectorAll('.cert-move-dropdown').forEach(d => d.remove());

      const card = btn.closest('.cert-file-card')!;
      document.querySelectorAll('.cert-move-dropdown').forEach(d => d.remove());
      const dropdown = document.createElement('div');
      dropdown.className = 'cert-move-dropdown';
      dropdown.innerHTML = categories
        .map(c => {
          const isCurrent = c.id === file.categoryId;
          return `<div class="cert-move-dropdown-item${isCurrent ? ' current' : ''}" data-target-cat-id="${c.id}">
            <img src="${escapeAttr(c.icon)}" width="14" height="14" alt="" />
            ${escapeHtml(c.name)}${isCurrent ? ' (当前)' : ''}
          </div>`;
        }).join('');
      card.appendChild(dropdown);

      dropdown.addEventListener('click', async (e) => {
        const target = (e.target as HTMLElement).closest('.cert-move-dropdown-item') as HTMLElement | null;
        if (!target) return;
        const targetCatId = Number(target.dataset.targetCatId);
        if (targetCatId === file.categoryId) { dropdown.remove(); return; }

        file.categoryId = targetCatId;
        await updateFileRecord(file);
        fileRecords = fileRecords.map(f => f.id === file.id ? file : f);

        card.classList.add('fade-out');
        setTimeout(() => {
          renderCertificatesPage();
        }, 200);
      });

      // Close on click outside
      const closeHandler = (e: MouseEvent) => {
        if (!dropdown.contains(e.target as Node)) {
          dropdown.remove();
          document.removeEventListener('click', closeHandler);
        }
      };
      setTimeout(() => document.addEventListener('click', closeHandler), 0);
    });
  });

  // File delete
  document.querySelectorAll<HTMLButtonElement>('.cert-file-action-btn.delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const fileId = Number(btn.dataset.fileId);
      const file = fileRecords.find(f => f.id === fileId);
      if (!file) return;

      if (file._confirmDelete) {
        delete file._confirmDelete;
        await deleteFileRecord(fileId);
        fileRecords = fileRecords.filter(f => f.id !== fileId);
        renderCertificatesPage();
      } else {
        file._confirmDelete = true;
        renderCertificatesPage();
        setTimeout(() => {
          if (file._confirmDelete) {
            file._confirmDelete = false;
            renderCertificatesPage();
          }
        }, 3000);
      }
    });
  });
}

function showPreviewModal(file: FileRecord) {
  const isImage = IMAGE_TYPES.has(file.fileType);
  const isPdf = file.fileType === 'application/pdf';
  const sameCategoryFiles = fileRecords.filter(f => f.categoryId === file.categoryId && IMAGE_TYPES.has(f.fileType));
  const currentIdx = sameCategoryFiles.findIndex(f => f.id === file.id);
  const hasNav = isImage && sameCategoryFiles.length > 1;

  let navHtml = '';
  if (hasNav) {
    navHtml = `
      <button class="cert-modal-nav prev" id="modalPrev">&#8249;</button>
      <button class="cert-modal-nav next" id="modalNext">&#8250;</button>
    `;
  }

  let bodyHtml: string;
  if (isImage) {
    const url = URL.createObjectURL(file.fileBody);
    bodyHtml = `<img src="${url}" alt="${escapeAttr(file.filename)}" />`;
  } else if (isPdf) {
    bodyHtml = `
      <div style="text-align:center">
        <div style="font-size:48px;margin-bottom:12px">📄</div>
      </div>
    `;
  } else {
    const { icon } = getFileCategoryIcon(file.fileType);
    bodyHtml = `
      <div style="text-align:center">
        <div style="font-size:48px;margin-bottom:12px">${icon}</div>
      </div>
    `;
  }

  let footerHtml = '';
  if (!isImage || !hasNav) {
    footerHtml = `
      <div class="cert-modal-info">
        <div class="cert-modal-info-name">${escapeHtml(file.filename)}</div>
        <div class="cert-modal-info-meta">
          <span>${formatFileSize(file.fileSize)}</span>
          <span>${file.fileType}</span>
        </div>
        ${isPdf ? `<button class="cert-modal-info-open" id="modalOpenNewTab">在新标签页中打开</button>` : ''}
      </div>
    `;
  }

  const overlay = document.createElement('div');
  overlay.className = 'cert-modal-overlay';
  overlay.innerHTML = `
    <div class="cert-modal">
      <button class="cert-modal-close" id="modalClose">&times;</button>
      ${navHtml}
      <div class="cert-modal-body">${bodyHtml}</div>
      ${footerHtml}
    </div>
  `;
  document.body.appendChild(overlay);

  let blobUrls: string[] = sameCategoryFiles.map(f => URL.createObjectURL(f.fileBody));
  let viewIdx = currentIdx;
  let imgEl = overlay.querySelector('.cert-modal-body img') as HTMLImageElement;

  function updateModalImage() {
    if (imgEl) {
      imgEl.src = blobUrls[viewIdx];
    }
  }

  overlay.querySelector('#modalClose')?.addEventListener('click', () => {
    overlay.remove();
    blobUrls.forEach(u => URL.revokeObjectURL(u));
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.remove();
      blobUrls.forEach(u => URL.revokeObjectURL(u));
    }
  });

  if (hasNav) {
    overlay.querySelector('#modalPrev')?.addEventListener('click', () => {
      viewIdx = (viewIdx - 1 + sameCategoryFiles.length) % sameCategoryFiles.length;
      updateModalImage();
    });
    overlay.querySelector('#modalNext')?.addEventListener('click', () => {
      viewIdx = (viewIdx + 1) % sameCategoryFiles.length;
      updateModalImage();
    });
  }

  if (isPdf) {
    overlay.querySelector('#modalOpenNewTab')?.addEventListener('click', () => {
      const url = URL.createObjectURL(file.fileBody);
      window.open(url, '_blank');
    });
  }

  // Keyboard nav
  const keyHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      overlay.remove();
      blobUrls.forEach(u => URL.revokeObjectURL(u));
      document.removeEventListener('keydown', keyHandler);
    }
    if (hasNav) {
      if (e.key === 'ArrowLeft') {
        viewIdx = (viewIdx - 1 + sameCategoryFiles.length) % sameCategoryFiles.length;
        updateModalImage();
      }
      if (e.key === 'ArrowRight') {
        viewIdx = (viewIdx + 1) % sameCategoryFiles.length;
        updateModalImage();
      }
    }
  };
  document.addEventListener('keydown', keyHandler);
}

// ===== Settings Page =====
function renderSettingsPage() {
  const api = apiConfigData ?? {
    baseUrl: '',
    apiKey: '',
    model: '',
    providerId: '',
    apiMode: 'chat_completions' as ApiMode,
    fastMode: false,
    aiEnhanced: true,
  };

  nextFieldId = 0;
  const fieldRows = textFields.map((f) => createFieldRowHtml(f.key, f.value)).join('');
  const repeatSummaryHtml = DEFAULT_REPEAT_SECTIONS.map((section) => {
    const block = blockCategories.find((candidate) => candidate.sectionId === section.id || candidate.title === section.title);
    const items = block?.items ?? [];
    const preview = items.slice(0, 2).map((item, index) => {
      const values = item.fields
        .filter((field) => field.value.trim())
        .slice(0, 3)
        .map((field) => `${escapeHtml(field.key)}：${escapeHtml(field.value)}`)
        .join(' · ');
      return `<div class="repeat-summary-row"><span>${index + 1}</span><p>${values || '空白条目'}</p></div>`;
    }).join('');
    return `
      <article class="repeat-summary-card${items.length ? '' : ' empty'}">
        <div class="repeat-summary-title"><span>${section.icon} ${section.title}</span><b>${items.length} 条</b></div>
        ${preview || '<div class="repeat-summary-empty">暂无条目</div>'}
        ${items.length > 2 ? `<div class="repeat-summary-more">另有 ${items.length - 2} 条</div>` : ''}
      </article>
    `;
  }).join('');

  pageContent.innerHTML = `
      <div class="settings-form">
        <div class="settings-section">
          <div class="settings-section-header">
            <h2>个人信息</h2>
            <div class="profile-data-actions">
              <button class="btn-secondary" id="exportProfileBtn">导出 JSON</button>
              <button class="btn-secondary" id="importProfileBtn">导入/更新 JSON</button>
              <button class="btn-secondary" id="appendProfileBtn">新增 JSON</button>
              <button class="btn-secondary" id="templateProfileBtn">下载模板</button>
            </div>
          </div>
          <p class="settings-section-hint">“导入/更新”会更新同名资料；“新增”只补充缺少字段并追加不重复的多行记录。备份不包含 API Key 和材料文件。</p>
          <ul class="profile-field-list" id="fieldList">${fieldRows}</ul>
          <button class="add-btn" id="addFieldBtn">+ 添加字段</button>
          <input type="file" id="profileImportInput" class="hidden" accept="application/json,.json" />
          <div class="repeat-settings-panel">
            <div class="repeat-settings-head">
              <div>
                <h3>多行资料</h3>
                <p>家庭成员、外语、经历、成果和奖励按“条目 + 子字段”保存，不会拆散成上面的普通字段。</p>
              </div>
              <button class="btn-secondary" id="editRepeatDataBtn">到首页编辑</button>
            </div>
            <div class="repeat-summary-grid">${repeatSummaryHtml}</div>
          </div>
      </div>

      <div class="settings-section">
        <h2>API 配置</h2>
        <div class="form-group">
          <label for="providerSelect">模型供应商</label>
          <select id="providerSelect">
            <option value="">自定义</option>
            ${buildProviderOptions(api.providerId)}
          </select>
        </div>
        <div class="form-group">
          <label for="baseUrl">Base URL</label>
          <input type="text" id="baseUrl" value="${escapeAttr(api.baseUrl)}" placeholder="https://api.openai.com/v1" />
        </div>
        <div class="form-group">
          <label for="apiMode">API 协议</label>
          <select id="apiMode">
            <option value="chat_completions"${api.apiMode === 'chat_completions' ? ' selected' : ''}>Chat Completions（/chat/completions）</option>
            <option value="responses"${api.apiMode === 'responses' ? ' selected' : ''}>Responses（/responses）</option>
          </select>
          <span class="api-key-hint">Codex 类模型或只支持 Responses 的中转请选择 Responses。</span>
        </div>
        <div class="form-group">
          <label for="apiKey">API Key</label>
          <input type="password" id="apiKey" value="${escapeAttr(api.apiKey)}" placeholder="请输入 API Key" />
          <span class="api-key-hint" id="apiKeyHint"></span>
        </div>
        <div class="form-group">
          <label for="modelSelect">模型</label>
          <select id="modelSelect">
            ${buildModelOptions(api.providerId, api.model)}
          </select>
          <input type="text" id="modelCustom" class="hidden" placeholder="输入自定义模型名称" />
        </div>
        <div class="form-group">
          <label>处理速度</label>
          <label class="fast-mode-option" for="fastMode">
            <input type="checkbox" id="fastMode"${api.fastMode ? ' checked' : ''} />
            <span>开启 Fast 模式</span>
          </label>
          <span class="api-key-hint">请求会携带 <code>service_tier: fast</code>。仅在模型和中转支持时开启，可能产生更高费用。</span>
        </div>
        <div class="form-group">
          <label>AI 参与方式</label>
          <label class="fast-mode-option" for="aiEnhanced">
            <input type="checkbox" id="aiEnhanced"${api.aiEnhanced ? ' checked' : ''} />
            <span>开启 AI 增强复核（推荐）</span>
          </label>
          <span class="api-key-hint">开启后，手动扫描会像 1.0 版一样把当前安全字段交给 API 复核，并由本地资料约束结果；关闭后 API 只处理本地规则无法匹配的空字段。</span>
        </div>
        <div class="settings-inline-actions">
          <button class="btn-secondary" id="testApiBtn" type="button">测试 API 连接</button>
          <span class="status-msg" id="apiTestStatus"></span>
        </div>
      </div>

      <div class="settings-section">
        <h2>扩展更新</h2>
        <p class="settings-section-hint">当前版本 ${escapeHtml(chrome.runtime.getManifest().version)}。保持同一个扩展目录和扩展 ID，重新加载不会清空资料、API 配置或材料库。</p>
        <button class="btn-secondary" id="reloadExtensionBtn">重新加载扩展</button>
      </div>

      <div class="settings-actions">
        <button id="saveBtn" class="save-btn">保存</button>
        <span id="statusMsg" class="status-msg"></span>
      </div>
    </div>
  `;

  document.getElementById('addFieldBtn')?.addEventListener('click', () => {
    const list = document.getElementById('fieldList')!;
    const row = createFieldRowEl('', '');
    list.appendChild(row);
    row.querySelector<HTMLInputElement>('.field-key')?.focus();
  });

  document.getElementById('providerSelect')?.addEventListener('change', onProviderChange);
  document.getElementById('modelSelect')?.addEventListener('change', onModelSelectChange);
  document.getElementById('testApiBtn')?.addEventListener('click', testApiConnection);

  document.getElementById('exportProfileBtn')?.addEventListener('click', exportProfileData);
  document.getElementById('importProfileBtn')?.addEventListener('click', () => {
    profileImportMode = 'merge';
    document.getElementById('profileImportInput')?.click();
  });
  document.getElementById('appendProfileBtn')?.addEventListener('click', () => {
    profileImportMode = 'append';
    document.getElementById('profileImportInput')?.click();
  });
  document.getElementById('templateProfileBtn')?.addEventListener('click', downloadProfileTemplate);
  document.getElementById('profileImportInput')?.addEventListener('change', importProfileData);
  document.getElementById('editRepeatDataBtn')?.addEventListener('click', () => switchPage('profile'));
  document.getElementById('saveBtn')?.addEventListener('click', saveSettings);
  document.getElementById('reloadExtensionBtn')?.addEventListener('click', () => {
    showStatus('正在重新加载扩展，资料不会被清空');
    setTimeout(() => chrome.runtime.reload(), 250);
  });
}

function buildProviderOptions(currentProviderId: string): string {
  const categories = ['domestic', 'aggregator', 'third-party', 'research', 'local'] as const;
  const categoryLabels: Record<string, string> = {
    domestic: '国内厂商',
    aggregator: '聚合平台',
    'third-party': '第三方',
    research: '研究机构',
    local: '本地 / 自部署',
  };

  return categories
    .map((cat) => {
      const providers = PROVIDER_PRESETS.filter((p) => p.category === cat);
      const options = providers
        .map((p) => {
          const sel = p.id === currentProviderId ? ' selected' : '';
          return `<option value="${p.id}"${sel}>${p.name}</option>`;
        })
        .join('');
      return `<optgroup label="${categoryLabels[cat]}">${options}</optgroup>`;
    })
    .join('');
}

function buildModelOptions(providerId: string, currentModel: string): string {
  if (!providerId) {
    const sel = currentModel ? '' : ' selected';
    return `<option value=""${sel}>请先选择供应商</option>${currentModel ? `<option value="${escapeAttr(currentModel)}" selected>${escapeHtml(currentModel)} (当前)</option>` : ''}<option value="__custom__">自定义模型...</option>`;
  }

  const provider = getProviderById(providerId);
  if (!provider || provider.models.length === 0) {
    const sel = currentModel ? '' : ' selected';
    return `<option value=""${sel}>自定义</option><option value="__custom__">自定义模型...</option>${currentModel ? `<option value="${escapeAttr(currentModel)}" selected>${escapeHtml(currentModel)} (当前)</option>` : ''}`;
  }

  const modelInList = provider.models.includes(currentModel);
  const options = provider.models
    .map((m) => {
      const sel = m === currentModel ? ' selected' : '';
      return `<option value="${m}"${sel}>${m}</option>`;
    })
    .join('');

  const customOpt = currentModel && !modelInList
    ? `<option value="${escapeAttr(currentModel)}" selected>${escapeHtml(currentModel)} (当前)</option>`
    : '';

  return `${options}${customOpt}<option value="__custom__">自定义模型...</option>`;
}

function onProviderChange() {
  const select = document.getElementById('providerSelect') as HTMLSelectElement;
  const providerId = select.value;
  const provider = getProviderById(providerId);
  const baseUrlInput = document.getElementById('baseUrl') as HTMLInputElement;
  const modelSelect = document.getElementById('modelSelect') as HTMLSelectElement;
  const modelCustom = document.getElementById('modelCustom') as HTMLInputElement;
  const apiKeyHint = document.getElementById('apiKeyHint');

  if (provider) {
    baseUrlInput.value = provider.baseUrl;
    if (provider.apiKeyUrl && apiKeyHint) {
      apiKeyHint.innerHTML = `获取 Key: <a href="${escapeAttr(provider.apiKeyUrl)}" target="_blank">${escapeHtml(provider.apiKeyUrl)}</a>`;
    } else if (apiKeyHint) {
      apiKeyHint.textContent = '';
    }
  } else {
    if (apiKeyHint) apiKeyHint.textContent = '';
  }

  modelSelect.innerHTML = buildModelOptions(providerId, '');
  modelCustom.classList.add('hidden');
  modelCustom.value = '';
}

function onModelSelectChange() {
  const modelSelect = document.getElementById('modelSelect') as HTMLSelectElement;
  const modelCustom = document.getElementById('modelCustom') as HTMLInputElement;
  if (modelSelect.value === '__custom__') {
    modelCustom.classList.remove('hidden');
    modelCustom.focus();
  } else {
    modelCustom.classList.add('hidden');
  }
}

function createFieldRowHtml(key: string, value: string): string {
  const id = nextFieldId++;
  return `
    <li class="field-row" data-id="${id}">
      <input type="text" class="field-key" placeholder="字段名" value="${escapeHtml(key)}" />
      <input type="text" class="field-value" placeholder="字段值" value="${escapeHtml(value)}" />
      <button class="btn-delete" title="删除">&times;</button>
    </li>
  `;
}

function createFieldRowEl(key: string, value: string): HTMLLIElement {
  const id = nextFieldId++;
  const row = document.createElement('li');
  row.className = 'field-row';
  row.dataset.id = String(id);
  row.innerHTML = `
    <input type="text" class="field-key" placeholder="字段名" value="${escapeHtml(key)}" />
    <input type="text" class="field-value" placeholder="字段值" value="${escapeHtml(value)}" />
    <button class="btn-delete" title="删除">&times;</button>
  `;
  row.querySelector('.btn-delete')!.addEventListener('click', () => row.remove());
  return row;
}

function collectProfileFieldsFromForm(): ProfileFieldData[] {
  const rows = document.querySelectorAll<HTMLElement>('.field-row');
  const fields: ProfileFieldData[] = [];
  const seenKeys = new Set<string>();

  rows.forEach((row) => {
    const key = (row.querySelector('.field-key') as HTMLInputElement)?.value.trim() ?? '';
    if (!key || seenKeys.has(key)) return;
    const value = (row.querySelector('.field-value') as HTMLInputElement)?.value.trim() ?? '';
    fields.push({ key, value });
    seenKeys.add(key);
  });

  return fields;
}

function downloadJson(filename: string, content: string) {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function exportProfileData() {
  const fields = collectProfileFieldsFromForm();
  const date = new Date();
  const stamp = date.toISOString().slice(0, 10).replace(/-/g, '');
  downloadJson(`baotian-profile-${stamp}.json`, stringifyProfileExport(fields, date, blockCategories));
  const rowCount = blockCategories.reduce((count, block) => count + block.items.length, 0);
  showStatus(`已备份 ${fields.length} 个字段和 ${rowCount} 条多行资料`);
}

function downloadProfileTemplate() {
  const templateBlocks = DEFAULT_REPEAT_SECTIONS.map((section) => ({
    title: section.title,
    sectionId: section.id,
    templateFields: section.fieldKeys,
    items: [],
  }));
  downloadJson('baotian-profile-template.json', stringifyProfileExport(PROFILE_TEMPLATE_FIELDS, new Date(), templateBlocks));
  showStatus('已下载模板');
}

async function importProfileData(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  try {
    const imported = parseProfileImportBundle(await file.text());
    if (imported.fields.length === 0 && imported.blocks.length === 0) {
      showStatus('未找到可导入资料');
      return;
    }

    const importedRows = imported.blocks.reduce((count, block) => count + block.items.length, 0);

    const importDescription = profileImportMode === 'append'
      ? '只新增缺少的普通字段，并向多行资料追加非重复条目；现有内容不会覆盖'
      : '同名普通字段会更新，重复资料分组会按文件内容替换；其他现有资料会保留';
    const confirmed = window.confirm(
      `将处理 ${imported.fields.length} 个字段和 ${importedRows} 条多行资料：${importDescription}。是否继续？`,
    );
    if (!confirmed) return;

    const mergedFields = profileImportMode === 'append'
      ? appendProfileFields(collectProfileFieldsFromForm(), imported.fields)
      : mergeProfileFields(collectProfileFieldsFromForm(), imported.fields);
    const mergedBlocks = profileImportMode === 'append'
      ? appendProfileBlocks(blockCategories, imported.blocks)
      : mergeProfileBlocks(blockCategories, imported.blocks);
    await saveAllTextFields(mergedFields);
    for (const block of mergedBlocks) {
      block.id = await saveBlockCategory(block);
    }
    textFields = mergedFields;
    blockCategories = mergedBlocks;
    renderSettingsPage();
    const statusPrefix = profileImportMode === 'append' ? '新增导入完成' : '导入更新完成';
    showStatus(`${statusPrefix}：已处理 ${imported.fields.length} 个字段和 ${importedRows} 条多行资料`);
  } catch (err) {
    showStatus(err instanceof Error ? err.message : '导入失败');
  } finally {
    input.value = '';
    profileImportMode = 'merge';
  }
}

async function saveSettings() {
  const fields = collectProfileFieldsFromForm();
  const baseUrl = (document.getElementById('baseUrl') as HTMLInputElement).value.trim();
  const apiKey = (document.getElementById('apiKey') as HTMLInputElement).value.trim();
  const model = getModelValue();
  const providerId = (document.getElementById('providerSelect') as HTMLSelectElement).value;
  const apiMode = (document.getElementById('apiMode') as HTMLSelectElement).value as ApiMode;
  const fastMode = (document.getElementById('fastMode') as HTMLInputElement).checked;
  const aiEnhanced = (document.getElementById('aiEnhanced') as HTMLInputElement).checked;

  if (apiKey && (!baseUrl || !model)) {
    showStatus('请完整填写 Base URL 和模型名称');
    return;
  }

  await saveAllTextFields(fields);
  textFields = fields;

  await setApiConfig({
    baseUrl,
    apiKey,
    model,
    providerId,
    apiMode,
    fastMode,
    aiEnhanced,
  });

  apiConfigData = {
    baseUrl,
    apiKey,
    model,
    providerId,
    apiMode,
    fastMode,
    aiEnhanced,
  };

  showStatus('已保存');
}

async function testApiConnection() {
  const status = document.getElementById('apiTestStatus');
  const button = document.getElementById('testApiBtn') as HTMLButtonElement | null;
  const config: ApiConfig = {
    baseUrl: (document.getElementById('baseUrl') as HTMLInputElement).value.trim(),
    apiKey: (document.getElementById('apiKey') as HTMLInputElement).value.trim(),
    model: getModelValue(),
    providerId: (document.getElementById('providerSelect') as HTMLSelectElement).value,
    apiMode: (document.getElementById('apiMode') as HTMLSelectElement).value as ApiMode,
    fastMode: (document.getElementById('fastMode') as HTMLInputElement).checked,
    aiEnhanced: (document.getElementById('aiEnhanced') as HTMLInputElement).checked,
  };
  if (!config.baseUrl || !config.apiKey || !config.model) {
    if (status) {
      status.textContent = '请先完整填写 Base URL、API Key 和模型';
      status.classList.add('show');
    }
    return;
  }

  if (button) button.disabled = true;
  if (status) {
    status.textContent = '正在真实调用 API…';
    status.classList.add('show');
  }
  try {
    const result = await matchFields([{
      index: 0,
      kind: 'text',
      tag: 'input',
      type: 'text',
      name: 'connection_test',
      id: 'connection_test',
      label: '连接测试',
      placeholder: '',
      ariaLabel: '',
      context: '仅用于验证 API 协议、模型和线路是否可用',
      fillMode: 'short',
    }], config, [{ key: '连接测试', value: '连接成功' }]);
    if (!result.length) throw new Error('API 已响应，但没有返回有效匹配结果');
    if (status) status.textContent = `连接成功：${config.model} · ${config.apiMode === 'responses' ? 'Responses' : 'Chat Completions'}${config.fastMode ? ' · Fast' : ''}`;
  } catch (error) {
    if (status) status.textContent = (error instanceof Error ? error.message : 'API 测试失败').replace(/\s+/g, ' ').slice(0, 180);
  } finally {
    if (button) button.disabled = false;
  }
}

function getModelValue(): string {
  const modelSelect = document.getElementById('modelSelect') as HTMLSelectElement;
  if (modelSelect.value === '__custom__') {
    return (document.getElementById('modelCustom') as HTMLInputElement).value.trim();
  }
  return modelSelect.value;
}

function showStatus(text: string) {
  const statusMsg = document.getElementById('statusMsg');
  if (!statusMsg) return;
  statusMsg.textContent = text;
  statusMsg.classList.add('show');
  setTimeout(() => statusMsg.classList.remove('show'), 2000);
}

// ===== Utils =====
function escapeHtml(text: string): string {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttr(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ===== Init =====
async function init() {
  await ensureCategoriesSeeded();
  const [rawFields, apiConfig, blocks, cats, files] = await Promise.all([
    getAllTextFields(),
    getApiConfig(),
    ensureProfileBlocksSeeded(),
    getAllCategories(),
    getAllFileRecords(),
  ]);

  // Migrate old English keys → Chinese keys
  const KEY_MIGRATION: Record<string, string> = {
    'name': '姓名',
    'phone': '手机号',
    'email': '邮箱',
    'address': '住址',
  };
  const fields = rawFields.map((f) => ({
    key: KEY_MIGRATION[f.key] ?? f.key,
    value: f.value,
  }));

  // Seed preset fields if missing
  const existingKeys = new Set(fields.map((f) => f.key));
  let needSave = false;
  for (const pf of PRESET_FIELDS) {
    if (!existingKeys.has(pf.key)) {
      fields.push({ key: pf.key, value: '' });
      needSave = true;
    }
  }
  if (needSave) {
    await saveAllTextFields(fields);
  }

  textFields = fields;
  apiConfigData = apiConfig;
  blockCategories = blocks;
  categories = cats;
  fileRecords = files;

  switchPage('profile');
}

init();
