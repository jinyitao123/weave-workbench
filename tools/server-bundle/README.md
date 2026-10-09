# Linux 服务端安装入口

本目录编排 Forge、官方 Forge 入口、Weave 与两个 PostgreSQL 16 实例。产品安装范围和空环境验收见[安装与初始化](../../docs/engineering/安装与初始化.md)，连接文件见[共享契约](../../contracts/v1/README.md#安装与组织连接)。

源码目录提供安装器与镜像锁模板；`images.template.json` 故意留空，不能用于启动。正式服务端包附带经过验证的 `images.lock.json` 和镜像构建证明，按准确摘要从获准访问的镜像仓库安装。安装器逻辑测试、镜像构建和真实空库初始化／员工登录分别验证，不互相替代。

## 管理员开始安装

服务器需要 Python 3.10+、本机 Linux Docker Engine 和 Compose 2.20+。Ubuntu 22.04/24.04/26.04 在 Docker 缺失时可显式加 `--install-docker`，使用 Ubuntu 签名软件仓库的 `docker.io`、`docker-compose-v2`；需要启用发行版的 `universe` 与更新源。其他 Linux 请先安装 Docker/Compose。已有 Docker 不会被自动更换。

发行方须先授予私有镜像读取权限；管理员按注册表要求完成 `docker login`，使用与安装命令相同的系统账号。安装器不读取或打印注册表凭据。示例地址和路径均由管理员替换：

```sh
sudo ./install.sh \
  --images ./images.lock.json \
  --forge-origin http://server.example.internal:8080 \
  --weave-origin http://server.example.internal:8081 \
  --host-gateway-host server.example.internal \
  --model-key-file /root/weave-model-key \
  --output /srv/organization-connection.json \
  --install-docker
```

模型输入文件只含管理员自己的 DeepSeek key，须由执行安装的账号所有、权限 `0600`。未提供时基础服务仍可安装，模型状态明确为未配置。默认模型为 `deepseek-flash`。安装器不读取其他应用或旧部署的环境文件。

向导启动正式服务后，提示管理员在 Forge 的 `/_console/setup` 完成原生首管和组织设置，再输入刚创建的本人邮箱、密码。密码通过终端隐藏输入，会话不保存；无需复制 cookie 或 token。安装器核对原生管理员权限，绑定当前组织，沿 Weave 正式 bootstrap 建立运维账号，并以本人交换身份调用共享模型绑定接口。最后导出无凭据的组织连接文件。

首次安装自动将 Forge 登录地址接入 Weave 管理端，并把 Forge 与 Weave 两个准确 origin 加入原生登录可信来源。管理员打开 `<weave-origin>/admin/`，直接使用 Forge 管理员或已获团队开发权限的账号登录。默认页面不展示 API Key；运维明确访问 `<weave-origin>/admin/?login=api_key` 时仍可用原密钥入口，权限不变。未接好 Forge 时页面显示配置问题，不自动切换密钥。

自动化场景可用 `--admin-credentials-file` 指定仅含 `email`、`password` 的私有 JSON 文件；权限和归属要求相同。该账号必须已经通过原生 Setup 创建。`--non-interactive` 没有此文件时返回 `native_setup_required` 和退出码 2，不制造账号或宣称安装全部完成。

## 地址和持久数据

默认直接发布 Forge 8080、Weave 8081；可通过 `--forge-port`、`--weave-port` 更改。数据库不发布主机端口。HTTP 与现有 HTTPS 入口均可使用；已有反向代理时显式加 `--external-ingress`，由管理员提供可达入口，安装器不会自动申请证书或推断 NAT。

Forge 的公开 origin、身份验证 endpoint 和桌面连接始终一致。DNS 名称在容器内需要经本机入口回连时，`--host-gateway-host` 必须等于 Forge 的规范主机名。固定 IP 可直接使用；实际网络能否回连由检查工具验证。不要把登录验证地址改成内部服务名。

私有状态默认在 `/var/lib/weave-workbench`，目录 `0700`、文件 `0600`。随机密码、加密密钥、事件密钥、稳定身份标识、镜像锁及组织绑定在首次生成后保留。相同参数重跑继续原安装；不同 origin、镜像锁或组织不会自动覆盖。镜像按固定仓库摘要使用，只拉取本机缺少的准确摘要，不因普通重启重复下载。四个 Compose 数据卷分别保存两个数据库、Forge 上传和 Weave 工作区。停止命令保留全部卷，安装器没有删除数据命令。

## 检查与恢复

默认入口是 `install.sh`；以下是同一安装的维护和恢复阶段：

```sh
sudo python3 server_bundle.py check
sudo python3 server_bundle.py stop
sudo python3 server_bundle.py start
sudo python3 server_bundle.py attach-organization
sudo python3 server_bundle.py export-connection --output /srv/organization-connection.json
```

所有命令可指定同一个 `--state-dir`。`set-model-key --key-file <私有文件>` 是显式模型 key 更新；随后 `start` 激活，再由本人 `attach-organization` 完成共享绑定。它不轮换其他密钥。bootstrap 已生成但私有运维 key 文件未保存完整时会拒绝猜测、重置或冒充恢复，需管理员处理该安装状态。

输出分别报告服务健康、容器到规范 origin 的身份验证、管理员交换、模型目录和共享修订、已发布团队、事件接线及桌面登录。服务健康的成功不证明模型实际执行、团队业务运行或员工桌面闭环；当前向导最终状态为 `base_installed_business_pending`。未配置团队会明确显示 `unconfigured`。业务团队需在正式开发入口创建/导入、试跑和发布。

共享模型 POST 回执与 `GET /v1/providers/system` 的目录摘要分别核验，要求 `mirrored`、`mirrored_as` 和 `mirror_revision` 与提交一致。目录不能读回时，安装器保留准确提交回执，报告 `mirror_committed_readback_unverified` 并返回退出码 2；普通凭据目录不作为服务凭据的查询入口。元数据就绪仍不代表模型执行通过。主服务默认关闭同机Runtime Host；直接绑定共享模型的Loom沿既有冻结授权执行。Codex、Claude Code和OpenCode由单独的执行节点安装及登录，注册、上报能力并领取任务，主服务不安装这些CLI。节点安装产物仍通过现有分发接口提供。

## 发行方验证

镜像锁格式为 `version: 1`、`bundleVersion` 和 `components`。`forge`、`forgeProxy`、`weave` 各包含完整 `image: repository@sha256:...` 与 40 位 `sourceRevision`；Forge 与入口镜像必须同源。`postgres` 包含摘要固定的 `image` 与 `major: 16`。禁止 `latest`、`unknown` 或未填模板。Weave 构建必须把同一完整来源 SHA 编入 `BUILD_COMMIT`，检查工具与其 `/v1/health` 实际读回比对。

```sh
python3 -m unittest discover -s tools/server-bundle/tests -v
sh -n tools/server-bundle/install.sh
sh -n tools/server-bundle/bootstrap-docker.sh
# 有 Docker Compose 的验证环境；仅解析配置，不拉镜像、不启动服务。
python3 tools/server-bundle/tests/validate_compose.py
```

正式交付仍须使用真实摘要镜像，在隔离 Linux 空库运行安装向导、原生 Setup、身份交换、模型调用、团队发布和重启持久性检查；本目录的模拟接口测试只验证安装器边界。
