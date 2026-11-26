# AI Coding Tool

Ứng dụng desktop Windows chuyên biệt cho **AI Coding** đa tác nhân (Multi-Agent), tích hợp sẵn **Claude Code**, **OpenAI Codex**, **Antigravity CLI (`agy`)** và **Gemini CLI**.

## Tính năng chính

- **Đổi AI Tool giữ 100% ngữ cảnh**: Chuyển linh hoạt giữa Claude Code, Codex, AGY, Gemini ngay trong một phiên làm việc; tự động đồng bộ `Session Memory` (mục tiêu, quyết định kỹ thuật, lưu ý ghim, file trọng tâm) và các lượt chưa đồng bộ (`<session_context_handoff>`).
- **Chạy song song & Git Worktree Isolation**: Chạy nhiều phiên AI đồng thời; hỗ trợ cô lập bằng Git Worktree (`.ai-coding-worktrees/`) để tránh xung đột file.
- **Turn Checkpoints & Monaco Diff**: Tự động chụp snapshot bằng `git write-tree` (không làm bẩn `git stash` hay `git log`) trước mỗi lượt AI; xem diff side-by-side bằng Monaco và hoàn tác 1 file hoặc cả lượt chỉ với 1 click.
- **Quản lý Skills (`SKILL.md`), `AGENTS.md` & MCP**: Trình chỉnh sửa tích hợp cho `SKILL.md`, `AGENTS.md` / `CLAUDE.md` / `GEMINI.md`, đồng bộ 1-click và kiểm tra MCP Servers.
- **Smart Composer & Embedded ConPTY Terminal**: Hỗ trợ `@file`, `@git-diff`, `/slash` templates/skills, dán ảnh `Ctrl+V`, duyệt `Plan → Execute` và terminal `xterm.js` mở interactive CLI.

---

## Yêu cầu trên máy Windows khác

1. **Windows 10 / 11 (x64)** và **Git for Windows** (dùng cho Turn Checkpoints, Diff, Worktree).
2. **Ít nhất 1 AI CLI** đã cài đặt & đăng nhập sẵn trên máy:
   - **Claude Code**: `npm install -g @anthropic-ai/claude-code` (sau đó chạy `claude` để đăng nhập)
   - **OpenAI Codex**: `npm install -g @openai/codex` (sau đó chạy `codex login`)
   - **Antigravity CLI (`agy`)** hoặc **Gemini CLI**: `npm install -g @google/gemini-cli`
   > Lưu ý: Có thể mở tab **Cài đặt → Chẩn đoán AI CLI** trong app để kiểm tra trạng thái đường dẫn hoặc bấm cài/cập nhật từng CLI.

---

## Cài đặt trên máy khác

### Cách 1 (Khuyên dùng cho người dùng cuối): Cài bằng file `.exe` từ GitHub Releases

Không cần cài Node.js hay build code trên máy đích:

1. Đăng nhập tài khoản GitHub có quyền truy cập repository Private này (`Hungsilver/ai-coding-tool`) trên trình duyệt.
2. Mở trang Releases: `https://github.com/Hungsilver/ai-coding-tool/releases`
3. Tải file cài đặt **`AI-Coding-Tool-Setup-<version>.exe`** ở bản phát hành mới nhất.
4. Chạy file `.exe` → Chọn thư mục cài đặt (mặc định Per-User trong AppData, không cần quyền Admin) → Mở **AI Coding Tool** từ Desktop / Start Menu.

### Cách 2 (Dành cho Dev / Chạy & sửa trực tiếp từ mã nguồn)

Yêu cầu thêm: **Node.js >= 20** (và tài khoản Git/GitHub có quyền clone repo Private).

```powershell
git clone https://github.com/Hungsilver/ai-coding-tool.git
cd ai-coding-tool
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1 -CreateShortcut
```

Script `scripts/install.ps1` sẽ tự động:
- Chạy `npm install` và xử lý luôn lỗi npm 11 bỏ qua script cài `electron.exe`.
- Build ứng dụng (`npm run build`).
- Tạo shortcut **AI Coding Tool** trên Desktop (khi truyền `-CreateShortcut`).

Để mở app ở chế độ dev:

```powershell
npm run dev
```

---

## Cập nhật khi có thay đổi mới

> **Bảo toàn dữ liệu 100%**: Toàn bộ lịch sử phiên AI, Session Memory, workspaces và cài đặt giao diện được lưu riêng tại `%APPDATA%\AiCodingTool\workspace.db`, không nằm trong thư mục cài đặt hay mã nguồn nên luôn được giữ nguyên khi cập nhật.

### Nếu máy đó cài bằng file `.exe` (Cách 1)

1. Trong app, vào **Cài đặt → Phiên bản & Cập nhật** → nhấn **Kiểm tra cập nhật** hoặc **Mở GitHub Releases**.
2. Tải file **`AI-Coding-Tool-Setup-<version>.exe`** mới nhất từ GitHub Releases (trên trình duyệt đã đăng nhập GitHub vì repo đang ở chế độ Private).
3. Chạy đè file `.exe` mới (chỉ mất vài giây, dữ liệu giữ nguyên).

### Nếu máy đó chạy từ mã nguồn Git (Cách 2)

- **Cách A (Trong app)**: Vào **Cài đặt → Kiểm tra cập nhật** → nếu có commit mới trên `main`, nhấn **Cập nhật từ Git**.
- **Cách B (PowerShell 1 lệnh)**:

```powershell
cd ai-coding-tool
powershell -ExecutionPolicy Bypass -File .\scripts\update.ps1
```

Script sẽ `git pull --ff-only origin main`, đồng bộ `npm install` và build lại bản mới.

---

## Dành cho người phát hành bản mới (Maintainer)

Khi bạn có code mới muốn phát hành cho các máy khác:

1. Cập nhật số phiên bản trong `package.json` (ví dụ `1.0.0` → `1.0.1`).
2. Commit và push lên nhánh `main`:
   ```powershell
   git add -A
   git commit -m "chore: release v1.0.1"
   git push origin main
   ```
3. Đánh tag phiên bản để **GitHub Actions** (`.github/workflows/release.yml`) tự động test, build `.exe` và đăng lên **GitHub Releases**:
   ```powershell
   git tag v1.0.1
   git push origin v1.0.1
   ```
4. Hoặc đóng gói `.exe` trực tiếp tại máy Windows:
   ```powershell
   npm run dist:win
   ```
   File cài đặt sẽ nằm trong `release\<version>\AI-Coding-Tool-Setup-<version>.exe`.

---

## Lệnh phát triển

```powershell
npm install       # Cài dependencies
npm run dev       # Chạy chế độ phát triển
npm run typecheck # Kiểm tra TypeScript (main + renderer)
npm test          # Chạy toàn bộ unit & integration tests
npm run build     # Build bản production (out/)
npm run dist:win  # Build và đóng gói Windows Installer (.exe)
```
