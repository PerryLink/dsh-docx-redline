# Troubleshooting — dsh-docx-redline

每条错误都按 **症状 / 原因 / 动作** 三行写。错误格式：`<一句人话>（E_DOC_…）｜下一步：<一个动作>`。
日志与产物在 `$DSH_HOME/storages/dsh-docx-redline/` 下；报告问题时只发**合成**样例，不要附加客户文档。

---

## E_DOC_FILE_UNREADABLE — 找不到这个文件

- **症状**：`doc_inspect` / `doc_change_summary` 提示「找不到这个文件（E_DOC_FILE_UNREADABLE）｜下一步：…」。
- **原因**：路径写错、文件被移动，或路径不在配置的输入根目录内（工具只读 `DSH_DOCX_INPUT_ROOTS`）。
- **动作**：确认文件存在；先用自带样例 `samples/quickstart/input/contract-v1.docx` 跑通，再换成自己的文件。

## E_DOC_PATH_NOT_ALLOWED — 路径不在允许的输入目录里

- **症状**：提示「这个路径不在允许的输入目录里（E_DOC_PATH_NOT_ALLOWED）」。
- **原因**：文件不在输入根目录下（根目录缺省是启动进程的 cwd，可用 `DSH_DOCX_INPUT_ROOTS` 配置，多个用路径分隔符隔开）。
- **动作**：把文件放进输入根目录，或设置 `DSH_DOCX_INPUT_ROOTS` 指向它所在目录后重试。

## E_DOC_DOC_NOT_FOUND — 找不到这份文档记录

- **症状**：`doc_roundtrip` / `doc_replace_text` / `redline_diff` 提示找不到 doc_id。
- **原因**：`doc_id` 是 `doc_inspect` 当场返回并存在会话表里的；换一次会话或没先 inspect 就没有该记录。
- **动作**：先跑 `doc_inspect`，把返回的 `doc_id` 原样传给后续工具。

## E_DOC_UNREADABLE — 不是可读的 DOCX

- **症状**：提示「not a readable DOCX/ZIP」或「missing [Content_Types].xml」。
- **原因**：不是 OOXML ZIP 包 —— 例如 `.doc`（97-2003 二进制）改了后缀、下载被截断、加密文档。
- **动作**：用 Word/WPS 另存为 `.docx` 后重试；加密文档先去密码。

## E_DOC_ZIP_LIMIT — 包体超过安全上限

- **症状**：提示条目过多、单条目过大或压缩比过高。
- **原因**：不是正常 DOCX，或触发了 ZIP 炸弹防护（条目 >1000、单条目 >4 MB、解压总量 >32 MB、压缩比 >100）。
- **动作**：确认文件来源可信并重新导出；确实超大的文档请拆分后再处理。

## E_DOC_WRITE_UNSUPPORTED — 不能安全地替换

- **症状**：`doc_replace_text` 提示「expected exactly one text match, found N」。
- **原因**：待替换文本在全文出现 0 次或多次，或文本被拆在多个 `w:t` 运行里。
- **动作**：换一个在文档中**唯一**的片段；跨运行的长句先拆短。工具宁可失败也不猜。

## E_DOC_REL_UNRESOLVED / E_DOC_REL_MISSING_PART — 关系不一致

- **症状**：`doc_relationship_check` 的 `issues` 里出现这两个代码（不是抛错，是检查结果）。
- **原因**：`document.xml` 用了未在 `word/_rels/document.xml.rels` 声明的 `r:id`，或内部目标部件缺失。
- **动作**：在 Word 里打开并另存一次通常会自动修复；本包只报告，不修复。

---

## 装不上 / 启用不了

- **症状**：`dsh plugin add dsh-docx-redline` 报版本不满足。
- **原因**：Node 或 DSH 版本低于包要求（`node >=24.9 <25`，`dsh >=0.2.1-rc.3 <0.4.0`）。
- **动作**：`node --version`、`dsh --version` 各看一次；升级后重试，并用 `--dump-config | grep dsh-docx-redline` 确认已启用。

## 跑测试

```sh
pnpm install --frozen-lockfile
pnpm build && node --test test/*.test.mjs
```

## 报告

到 <https://github.com/PerryLink/dsh-docx-redline/issues> 提交：包版本、命令、报错原文、一份**合成** `.docx`。客户文档请先脱敏，或只描述结构。
