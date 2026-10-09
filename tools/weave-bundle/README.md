# Weave独立Compose部署入口

只启动Weave与官方PostgreSQL 16，数据库和工作区分别使用持久卷。配置、运维bootstrap、凭据保存及状态核对复用Weave既有能力；不部署Forge、不新增业务组织或员工账号。安装流程主文档见[安装与初始化](../../docs/engineering/安装与初始化.md#weave独立部署)。

包内固定两个真实镜像摘要、原始构建／启动证明与源版本。Python 3.10以上、Linux x86_64、Docker Engine／Compose 2.20以上及两个镜像的读取能力是安装条件。Weave镜像继续使用既有私有GHCR包授权，部署管理员先正常docker login。

```sh
cp installation.example.json installation.json
# 填写origin、port、bindAddress与可选模型私有文件路径。
python3 weave_bundle.py configure --config installation.json
docker compose up -d --wait
python3 weave_bundle.py bootstrap
```

运维初始化沿现有`weave bootstrap`，生成的Key仅存入当前目录的0600私有文件`operator-key.local`，命令不回显。使用受限编辑器或密码管理器读取该文件，并访问配置地址的`/admin/?login=api_key`登录。普通密码登录保持关闭；初始化结果未知会拒绝重放，不自动重造Key或删除卷。再次bootstrap核对同一运维主体，不创建第二份Key。

日常使用`docker compose ps`、`stop`与`up -d --wait`。`.env`、`.weave-state.local.json`和Key文件共同保留，相同配置不会重置JWT／凭据加密密钥、数据库密码、项目或工作区；不同配置明确拒绝覆盖。模型密钥来自管理员自己的0600文件，默认模型为deepseek-flash；未配置模型时不宣称团队已能实际执行。

可选接入已有Forge时，同时配置`forgeOrigin`与该系统的真实`forgeWorkspaceId`，后者来自原生组织会话，不自造业务组织。Forge管理员须把Weave准确公开origin加入其可信来源；员工／开发者仍使用Forge本人账号。委托、材料、业务动作与事件通知接线仍遵循[既有契约](../../contracts/v1/README.md)，仅配置登录不代表业务闭环完成。

主服务没有Codex／Claude／OpenCode CLI或同机执行节点，节点按既有Runtime Host协议单独注册。HTTPS采用部署方已有反向代理，包不申请证书。健康、运维身份、重启持久性与实际模型／业务执行分别记录。
