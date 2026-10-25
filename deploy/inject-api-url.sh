#!/bin/sh

set -e

# 只注入规范化的布尔值，防止将任意环境变量内容拼入前端脚本。
SITE_MODE_ENABLED=true
if [ "$SITE_MODE" = "false" ]; then
    SITE_MODE_ENABLED=false
fi

# 用环境变量替换前端默认 API URL。显式传入空字符串时保留为空。
if [ "${DEFAULT_API_URL+x}" != "x" ]; then
    DEFAULT_API_URL=${API_URL:-https://api.openai.com/v1}
fi
DOCKER_LEGACY_API_URL_USED=${DOCKER_LEGACY_API_URL_USED:-false}
if [ -n "$API_URL" ]; then
    DOCKER_LEGACY_API_URL_USED=true
fi

API_PROXY_AVAILABLE=false
if [ "$ENABLE_API_PROXY" = "true" ]; then
    API_PROXY_AVAILABLE=true
fi

API_PROXY_LOCKED=false
if [ "$ENABLE_API_PROXY" = "true" ] && [ "$LOCK_API_PROXY" = "true" ]; then
    API_PROXY_LOCKED=true
fi

PRESET_CONFIG_ONLY=false
if [ "$SHOW_PRESET_CONFIG_ONLY" = "true" ] || [ "$SHOW_DEFAULT_CONFIG_ONLY" = "true" ]; then
    PRESET_CONFIG_ONLY=true
fi

PRESET_CONFIG_PARAMS_LOCKED=false
if [ "$LOCK_PRESET_CONFIG_PARAMS" = "true" ]; then
    PRESET_CONFIG_PARAMS_LOCKED=true
fi

PRESET_CONFIG_DELETION_PREVENTED=false
if [ "$PREVENT_PRESET_CONFIG_DELETION" = "true" ]; then
    PRESET_CONFIG_DELETION_PREVENTED=true
fi

# 将公共部署值编码到独立脚本，避免引号、换行或中文破坏 JavaScript 语法。
encode_runtime_value() {
    printf '%s' "$1" | base64 | tr -d '\n'
}

DEFAULT_API_URL_TRIMMED=$(printf '%s' "$DEFAULT_API_URL" | sed 's/^[[:space:]]*//')
case "$DEFAULT_API_URL_TRIMMED" in
    http://*|https://*)
        DEFAULT_CONFIG_URL_PATH=${DEFAULT_API_URL_TRIMMED%%\?*}
        DEFAULT_CONFIG_URL_PATH=${DEFAULT_CONFIG_URL_PATH%%\#*}
        DEFAULT_CONFIG_URL_PATH_LOWER=$(printf '%s' "$DEFAULT_CONFIG_URL_PATH" | tr '[:upper:]' '[:lower:]')
        case "$DEFAULT_CONFIG_URL_PATH_LOWER" in
            *.json)
                if ! DEFAULT_CONFIG_JSON=$(wget -qO- "$DEFAULT_API_URL_TRIMMED"); then
                    echo "预置配置请求失败：$DEFAULT_API_URL_TRIMMED" >&2
                    exit 1
                fi
                DEFAULT_API_URL="embedded-config:$(printf '%s' "$DEFAULT_CONFIG_JSON" | base64 | tr -d '\n')"
                ;;
        esac
        ;;
    file://*)
        DEFAULT_CONFIG_PATH=${DEFAULT_API_URL_TRIMMED#file://}
        if [ ! -f "$DEFAULT_CONFIG_PATH" ]; then
            echo "预置配置文件不存在：$DEFAULT_CONFIG_PATH" >&2
            exit 1
        fi
        DEFAULT_API_URL="embedded-config:$(base64 < "$DEFAULT_CONFIG_PATH" | tr -d '\n')"
        ;;
    *)
        if [ -f "$DEFAULT_API_URL_TRIMMED" ]; then
            DEFAULT_API_URL="embedded-config:$(base64 < "$DEFAULT_API_URL_TRIMMED" | tr -d '\n')"
        else
            case "$DEFAULT_API_URL_TRIMMED" in
                *.json)
                    echo "预置配置文件不存在：$DEFAULT_API_URL_TRIMMED" >&2
                    exit 1
                    ;;
            esac
        fi
        ;;
esac

# 只重写不缓存的运行时配置，不再改动 Vite 带 hash 的代码资源；先完整写入再原子替换。
RUNTIME_CONFIG_TMP=$(mktemp /usr/share/nginx/html/.runtime-config.XXXXXX)
trap 'rm -f "$RUNTIME_CONFIG_TMP"' 0
cat > "$RUNTIME_CONFIG_TMP" <<EOF
// 公共部署配置；Base64 仅用于安全编码，不用于隐藏密钥。
window.__GPT_IMAGE_RUNTIME_CONFIG__ = Object.fromEntries(Object.entries({
  VITE_SITE_MODE: "$(encode_runtime_value "$SITE_MODE_ENABLED")",
  VITE_DEFAULT_API_URL: "$(encode_runtime_value "$DEFAULT_API_URL")",
  VITE_API_PROXY_AVAILABLE: "$(encode_runtime_value "$API_PROXY_AVAILABLE")",
  VITE_API_PROXY_LOCKED: "$(encode_runtime_value "$API_PROXY_LOCKED")",
  VITE_DOCKER_DEPLOYMENT: "$(encode_runtime_value true)",
  VITE_DOCKER_LEGACY_API_URL_USED: "$(encode_runtime_value "$DOCKER_LEGACY_API_URL_USED")",
  VITE_SHOW_PRESET_CONFIG_ONLY: "$(encode_runtime_value "$PRESET_CONFIG_ONLY")",
  VITE_LOCK_PRESET_CONFIG_PARAMS: "$(encode_runtime_value "$PRESET_CONFIG_PARAMS_LOCKED")",
  VITE_PREVENT_PRESET_CONFIG_DELETION: "$(encode_runtime_value "$PRESET_CONFIG_DELETION_PREVENTED")",
  VITE_DEFAULT_UI_FONT: "$(encode_runtime_value "$DEFAULT_UI_FONT")",
  VITE_DEFAULT_MONO_FONT: "$(encode_runtime_value "$DEFAULT_MONO_FONT")",
  VITE_BUILTIN_FONT_SOURCE: "$(encode_runtime_value "$BUILTIN_FONT_SOURCE")"
}).map(([name, value]) => [name, new TextDecoder().decode(Uint8Array.from(atob(value), (char) => char.charCodeAt(0)))]))
EOF
chmod 644 "$RUNTIME_CONFIG_TMP"
mv -f "$RUNTIME_CONFIG_TMP" /usr/share/nginx/html/runtime-config.js

# 检查是否启用了 API 代理
if [ "$ENABLE_API_PROXY" != "true" ]; then
    # 删除代理配置块
    sed -i '/# BEGIN API PROXY/,/# END API PROXY/d' /etc/nginx/conf.d/default.conf
fi

exec "$@"
