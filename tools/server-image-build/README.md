# 服务端镜像构建

这里只构建交付镜像，安装与初始化仍由[安装主文档](../../docs/engineering/安装与初始化.md)及现有 `tools/server-bundle` 负责。不会访问部署服务器、启动业务服务或写入模型配置。

在完整历史的已提交总仓 checkout 中执行，先查看确定的构建输入：

```sh
python3 tools/server-image-build/build.py --plan \
  --repository <owner>/<repository> --revision <总仓完整SHA> \
  --bundle-version 0.1.0-rc.5
```

构建主机需要 Docker Buildx、Python 3、Git，以及 Console 锁要求的 Node 和 pnpm。准备一个包含锁定 ObjectUI 提交的只读 checkout 后执行：

```sh
python3 tools/server-image-build/build.py \
  --repository <owner>/<repository> --revision <总仓完整SHA> \
  --bundle-version 0.1.0-rc.5 --objectui-source <ObjectUI只读checkout>
```

默认生成三个 Linux amd64 本地镜像和 `.build/server-image-build/output` 下的构建证明。构建使用 `git archive` 导出组件锁的确切提交，不复制本地 WIP、未跟踪文件或运行配置。Console 使用 Forge 已有构建/逐文件摘要验证，禁止 `--refresh-lock`；Forge 的 app/proxy 和 Weave 使用组件原 Dockerfile。构建证明保留来源、锁文件摘要、Dockerfile 摘要、Console 清单和 BuildKit 元数据，不把本地 image ID 当成 registry digest。

输出目录必须为空，已有证据不会被覆盖。构建失败保留失败状态及已完成的证明，不生成一份声称完整交付的安装锁。

确需发布时，先以有权身份正常登录 GHCR，再提供仅本次命令可用的 `GH_TOKEN` 并显式加 `--push-private`。脚本在推送前后核对源码仓库准确身份与实际可见性（公开或私有），并要求GHCR package仍为私有；已有公开包会被拒绝，不自动改变可见性。新包采用 GHCR 的默认私有行为，随后仍须读回实际私有状态。GitHub 包接口允许仓库关联字段为空，清单如实记录 `not_reported`，不声称后台已经关联或确定未关联；非空关联与当前仓库身份或可见性不一致仍拒绝。实际来源通过已构建 OCI 配置中的仓库、组件提交及产品提交标签核对，再验证远端 registry manifest 的配置摘要与该 OCI 配置完全一致。只有三个镜像的真实 registry digest 和配置关系均成功读回，才输出安装器版本 1 接受的 `images.lock.json`。私有包权限读回失败就停止，不以猜测代替结果。[GitHub 容器注册表说明](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)及[官方API定义](https://github.com/github/rest-api-description/blob/main/descriptions/api.github.com/api.github.com.2022-11-28.json)

PostgreSQL 默认先解析官方 `postgres:16-bookworm`，实际执行 `postgres --version` 核对主版本 16，并将仓库 digest 固定到产物锁。也可通过 `--postgres-image postgres:16-bookworm@sha256:<摘要>` 复用已审查的摘要。应用镜像从不使用 `latest` 或 `unknown` 发布标签。

手动工作流 `server-image-build.yml` 固定总仓提交、完整历史与只读 ObjectUI deploy key，默认不推送，只上传构建证明。证明随源码仓库的可见性提供，不包含部署地址、登录凭据或模型配置；源码仓库公开不会自动公开容器package。工作流未进入默认分支前不能以此名称直接 dispatch；文件存在不表示 CI 或真实安装已经通过。

已发布成功、仅主机传送失败时，在同一工作流填写 `published_run_id`，`revision` 必须仍为该原发布运行的完整 `head_sha`，版本保持一致；设 `publish_private=false`、`stage_installation_host=true`。此模式检出当前工作流的控制提交，校验原运行与准确制品的官方 ZIP 摘要、安全条目、原提交锁和镜像证明，再复查实际私有状态，直接复用原 SSH 传送步骤。它不安装 Node、不读取 ObjectUI、不构建或再次发布镜像，也不将旧主机回执当成本次传送成功。`resume-proof.json` 分别记录原发布运行／源码与本次控制源码；再次重试仍指向原发布运行。

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tools/server-image-build/tests -v
```

这些测试检查锁、参数、安装器格式和私有发布边界；不替代真实 Docker 构建、首次管理员、登录交换或业务验收。

## 只替换中央 Weave 镜像

已核的 Forge、Console 与 PostgreSQL 不变时，可指定原完整发布运行，仅构建瘦 Weave。它是固定的单组件替换入口，不接受任意组件列表，也不复用另一份组合发布作为基础：

```sh
python3 tools/server-image-build/build.py \
  --repository <owner>/<repository> --revision <本次总仓完整SHA> \
  --bundle-version 0.1.0-rc.5 --push-private \
  --replace-weave-from-run <原完整发布运行ID> \
  --base-revision <原完整发布来源SHA>
```

手动工作流对应填写 `reuse_forge_run_id`、`reuse_forge_revision`，保留本次 `revision`，显式设置 `publish_private=true`。不能同时填写 `published_run_id`。此路径不准备 Node/pnpm/ObjectUI、不重编译 Forge、不下载桌面产物。原官方 artifact 仍经过运行身份、官方归档摘要和原提交的完整严格校验；本次 Forge 组件锁与 Console 锁必须完全一致。

Weave 使用 `--target server`。对实际镜像检查 `opencode`、`codex`、`claude` 命令及对应全局 npm 包均不存在，并检查实际 Go 二进制包含 Loom 模块及本地替换路径。源码中的 `third_party/loom` Git tree 单独记录。随后用产品锁中的**官方 PostgreSQL 16 精确摘要**创建隔离内部网络、临时空库和 Weave 探针容器，读取 `/v1/health` 的准确 `build_commit` 及 `/v1/ready`；不传入任何业务或模型配置。探针失败即停止发布，不换用 pgvector 镜像掩盖数据库问题。探针使用独立随机的数据库密码、JWT secret及64位hex的 `WEAVE_SECRET_KEY`，输入创建即0600，不读取部署密钥。失败时先保存容器状态和末尾60行日志，每字段最多16 KiB，替换本次三个随机凭据并去掉URL；诊断作为单独的失败artifact上传，不进入成功镜像证明或恢复白名单。随后清理本次随机命名的探针容器/网络和临时输入，不接触安装环境。

成功产物使用 `schemaVersion: 2`、`kind: weave-replacement` 的构建证明：`componentBuildSources` 明确旧 Forge/proxy/PostgreSQL 的原发布来源和新 Weave 的构建来源；`images` 只保存本次 Weave 的新证明。原7份证明以 `base-` 前缀逐字节保留，不改标签、来源或摘要。组合 `images.lock.json` 仍符合安装器既有 version 1 格式，旧三个镜像条目原样，只替换 Weave 条目。

传送断线后，仍通过已有 `published_run_id` 恢复，指定**这次组合构建的运行和来源**，不要指向后续仅恢复运行。恢复器识别有限的组合证据条目，再从 GitHub 独立读回原完整发布，逐字节比较保存的原证明，核对本次来源、Dockerfile、Weave config/registry digest、服务器探针与 Loom tree。原完整发布的同来源校验没有放松；来源混用、修改旧锁或使用 executor 镜像都拒绝。通过后复用原 SSH 接收器，私有 package、白名单与临时认证清理不变。

这里的单元测试只覆盖证据和操作边界。真实镜像、官方空库健康与首次安装结果必须由实际构建/安装运行另行记录，不因测试通过而提前宣称部署可用。
