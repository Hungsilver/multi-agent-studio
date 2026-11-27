# Multi-Agent Studio

Ứng dụng desktop Windows toàn diện cho **Multi-Agent AI Coding**, **Git Studio**, **Quản lý Ứng dụng Dev (.NET / Vite / IIS)** và **Skills & Rules**, tích hợp sẵn **Claude Code** (`claude`), **OpenAI Codex** (`codex`) và **Antigravity CLI** (`agy`).

## Tính năng chính

- **Đổi AI Tool giữ 100% ngữ cảnh**: Chuyển linh hoạt giữa Claude Code, Codex, AGY ngay trong một phiên làm việc; tự động đồng bộ `Session Memory` (mục tiêu, quyết định kỹ thuật, lưu ý ghim, file trọng tâm) và các lượt chưa đồng bộ (`<session_context_handoff>`).
- **Chế độ Orchestrator (Planner → Executor)**: Tự động điều phối tác nhân Lập kế hoạch → Thực thi → Kiểm duyệt lại giữa các AI model/tool khác nhau.
- **Chạy song song & Git Worktree Isolation**: Chạy nhiều phiên AI đồng thời; hỗ trợ cô lập bằng Git Worktree (`.ai-coding-worktrees/`) để tránh xung đột file, kèm modal xử lý merge conflict trực quan.
- **Turn Checkpoints & Monaco Diff**: Tự động chụp snapshot bằng `git write-tree` (không làm bẩn `git stash` hay `git log`) trước mỗi lượt AI; xem diff side-by-side bằng Monaco và hoàn tác 1 file hoặc cả lượt chỉ với 1 click.
- **Git Studio (tương đương SourceTree)**: Cây commit đồ họa nhiều nhánh, Staging/Hunk/Line Diff, Commit/Amend, Branch CRUD, Merge/Rebase/Cherry-pick/Revert, Stash & Tag, Pull/Push/Fetch.
- **Ứng dụng Dev (Apps Studio)**: Tự động quét & khởi chạy project `.NET 8`, `Vite`, Console Tool và quản lý site IIS; Start theo thứ tự (`tool → backend → bff → frontend`), xem CPU/RAM/HTTP health, Live Log theo thời gian thực, Auto-Restart khi sập, chia sẻ mạng LAN / Tailscale và DevTunnel.
- **Quản lý Skills (`SKILL.md`), `AGENTS.md` & MCP**: Trình chỉnh sửa tích hợp cho `SKILL.md`, `AGENTS.md` / `CLAUDE.md` / `GEMINI.md`, đồng bộ 1-click và kiểm tra MCP Servers.
- **Smart Composer & Embedded ConPTY Terminal**: Hỗ trợ `@file`, `@git-diff`, `/slash` templates/skills, dán ảnh `Ctrl+V`, theo dõi context/compact, vòng đo hạn mức CLI và terminal `xterm.js` tương tác trực tiếp.

---

## Yêu cầu trên máy Windows khác

1. **Windows 10 / 11 (x64)** và **Git for Windows** (dùng cho Turn Checkpoints, Git Studio, Worktree).
2. **Ít nhất 1 AI CLI** đã cài đặt & đăng nhập sẵn trên máy:
   - **Claude Code**: `npm install -g @anthropic-ai/claude-code` (sau đó chạy `claude` để đăng nhập)
   - **OpenAI Codex**: `npm install -g @openai/codex` (sau đó chạy `codex login`)
   - **Antigravity CLI (`agy`)**: chạy trong PowerShell `irm https://antigravity.google/cli/install.ps1 | iex` (script cài `agy.exe` vào `%LOCALAPPDATA%\agy\bin`; kiểm tra bằng `agy --version`, lần đầu chạy `agy` để đăng nhập)
   > Lưu ý: Có thể mở tab **Cài đặt → Chẩn đoán AI CLI** trong app để kiểm tra trạng thái đường dẫn hoặc bấm cài/cập nhật từng CLI.

---

## Cài đặt trên máy khác

### Cách 1 (Khuyên dùng cho người dùng cuối): Cài bằng file `.exe` từ GitHub Releases

Không cần cài Node.js hay build code trên máy đích:

1. Đăng nhập tài khoản GitHub có quyền truy cập repository (`Hungsilver/multi-agent-studio`) trên trình duyệt.
2. Mở trang Releases: `https://github.com/Hungsilver/multi-agent-studio/releases`
3. Tải file cài đặt **`Multi-Agent-Studio-Setup-<version>.exe`** ở bản phát hành mới nhất.
4. Chạy file `.exe` → Chọn thư mục cài đặt (mặc định Per-User trong AppData, không cần quyền Admin) → Mở **Multi-Agent Studio** từ Desktop / Start Menu.

### Cách 2 (Dành cho Dev / Chạy & sửa trực tiếp từ mã nguồn)

Yêu cầu thêm: **Node.js >= 20** (và tài khoản Git/GitHub có quyền clone repo).

```powershell
git clone https://github.com/Hungsilver/multi-agent-studio.git
cd multi-agent-studio
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1 -CreateShortcut
```

Script `scripts/install.ps1` sẽ tự động:
- Chạy `npm install` và xử lý luôn lỗi npm 11 bỏ qua script cài `electron.exe`.
- Build ứng dụng (`npm run build`).
- Tạo shortcut **Multi-Agent Studio** trên Desktop (khi truyền `-CreateShortcut`).

Để mở app ở chế độ dev:

```powershell
npm run dev
```

---

## Cập nhật khi có thay đổi mới

> **Bảo toàn dữ liệu 100%**: Toàn bộ lịch sử phiên AI, Session Memory, workspaces, danh mục Apps và cài đặt giao diện được lưu riêng tại `%APPDATA%\MultiAgentStudio\` (`workspace.db`, `apps.json`), không nằm trong thư mục cài đặt hay mã nguồn nên luôn được giữ nguyên khi cập nhật.

### Nếu máy đó cài bằng file `.exe` (Cách 1)

1. Trong app, vào **Cài đặt → Phiên bản & Cập nhật** → nhấn **Kiểm tra cập nhật** hoặc **Mở GitHub Releases**.
2. Tải file **`Multi-Agent-Studio-Setup-<version>.exe`** mới nhất từ GitHub Releases.
3. Chạy đè file `.exe` mới (chỉ mất vài giây, dữ liệu giữ nguyên).

### Nếu máy đó chạy từ mã nguồn Git (Cách 2)

- **Cách A (Trong app)**: Vào **Cài đặt → Kiểm tra cập nhật** → nếu có commit mới trên `main`, nhấn **Cập nhật từ Git**.
- **Cách B (PowerShell 1 lệnh)**:

```powershell
cd multi-agent-studio
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
   File cài đặt sẽ nằm trong `release\<version>\Multi-Agent-Studio-Setup-<version>.exe`.

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
