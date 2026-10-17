/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { MessageDecorationProps } from "@api/MessageDecorations";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { Paragraph } from "@components/Paragraph";
import { classNameFactory } from "@utils/css";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import type { Role } from "@vencord/discord-types";
import { filters, findComponentByCodeLazy, findCssClassesLazy, findModuleId, wreq } from "@webpack";
import { GuildMemberStore, GuildRoleStore, GuildStore, TextInput, useState, useStateFromStores } from "@webpack/common";

const logger = new Logger("CustomRoleBadge");
const cl = classNameFactory("vc-crb-");

const RoleIconComponent = findComponentByCodeLazy("#{intl::ROLE_ICON_ALT_TEXT}");
const { roleIcon: roleIconClass } = findCssClassesLazy("roleIcon", "separator");

// Discord's getRoleIconData(role, size), used by every role icon in the client (role lists, role pills, ...)
const ROLE_ICON_DATA_CODE = ["convertSurrogateToName", "customIconSrc", "unicodeEmoji"] as const;
const ROLE_ICONS_FEATURE = "ROLE_ICONS";

interface RoleBadge {
    id: string;
    guildId: string;
    roleId: string;
    url: string;
}

const makeBadge = (guildId = "", roleId = "", url = ""): RoleBadge => ({
    id: crypto.randomUUID(),
    guildId,
    roleId,
    url
});

const settings = definePluginSettings({
    badgesEditor: {
        type: OptionType.COMPONENT,
        component: () => <BadgesEditor />
    },
    badges: {
        type: OptionType.CUSTOM,
        default: [makeBadge()] as RoleBadge[],
        description: "Custom role icons"
    },
    spoofRoleIconsFeature: {
        type: OptionType.BOOLEAN,
        description: "Make Discord treat the configured servers as if they had the Role Icons boost perk (needed for the icons to show up in role lists). This also reveals the server's real role icons.",
        default: true,
        onChange: () => syncRoleIconsFeature()
    },
    showInChat: {
        type: OptionType.BOOLEAN,
        description: "Show the custom icon after the username in chat",
        default: true
    }
});

const SNOWFLAKE_RE = /^\d{17,20}$/;
const isComplete = (b: RoleBadge) => !!b.guildId && !!b.roleId && !!b.url;

/**
 * Role ids are globally unique, so the guild id is only used to double check when it is known
 */
function findBadge(roleId: string | undefined, guildId?: string) {
    if (!roleId) return undefined;
    return settings.store.badges.find(b => isComplete(b) && b.roleId === roleId && (!guildId || b.guildId === guildId));
}

function getCustomIconData(role: Role | undefined) {
    const badge = findBadge(role?.id, role?.guildId);
    if (!badge) return null;

    return { customIconSrc: badge.url, unicodeEmoji: undefined };
}

// region ROLE_ICONS feature spoofing

const spoofedGuilds = new Set<string>();

function syncRoleIconsFeature() {
    const wanted = new Set(
        settings.store.spoofRoleIconsFeature
            ? settings.store.badges.filter(isComplete).map(b => b.guildId)
            : []
    );

    for (const guildId of wanted) {
        const features = GuildStore.getGuild(guildId)?.features;
        if (!features || features.has(ROLE_ICONS_FEATURE)) continue;

        features.add(ROLE_ICONS_FEATURE);
        spoofedGuilds.add(guildId);
    }

    for (const guildId of spoofedGuilds) {
        if (wanted.has(guildId)) continue;

        GuildStore.getGuild(guildId)?.features.delete(ROLE_ICONS_FEATURE);
        spoofedGuilds.delete(guildId);
    }
}

function unspoofAll() {
    for (const guildId of spoofedGuilds) {
        GuildStore.getGuild(guildId)?.features.delete(ROLE_ICONS_FEATURE);
    }
    spoofedGuilds.clear();
}

// endregion

// region getRoleIconData export override

// The patch below rewrites getRoleIconData itself. This is a fallback for when that patch breaks:
// every other module calls getRoleIconData through the module exports, so overriding the export still covers them.
const restoreExports: Array<() => void> = [];

function overrideRoleIconDataExport() {
    const moduleId = findModuleId(...ROLE_ICON_DATA_CODE);
    if (moduleId == null) return;

    const exports = wreq(moduleId as any);
    if (exports == null || typeof exports !== "object") return;

    const isRoleIconData = filters.byCode(...ROLE_ICON_DATA_CODE);

    for (const key of Object.keys(exports)) {
        const original = exports[key];
        if (typeof original !== "function" || !isRoleIconData(original)) continue;

        const wrapped = function (this: unknown, role: Role, ...args: any[]) {
            return getCustomIconData(role) ?? original.call(this, role, ...args);
        };

        try {
            Object.defineProperty(exports, key, { configurable: true, enumerable: true, get: () => wrapped });
            restoreExports.push(() => Object.defineProperty(exports, key, { configurable: true, enumerable: true, get: () => original }));
        } catch (e) {
            logger.error("Failed to override getRoleIconData", e);
        }
    }
}

// endregion

// region Chat

function getTopBadgeRoleId(guildId: string | undefined, userId: string | undefined) {
    if (!guildId || !userId) return null;

    const member = GuildMemberStore.getMember(guildId, userId);
    if (!member) return null;

    let top: Role | undefined;
    for (const roleId of member.roles) {
        if (!findBadge(roleId, guildId)) continue;

        const role = GuildRoleStore.getRole(guildId, roleId);
        if (role && (!top || role.position > top.position)) top = role;
    }

    return top?.id ?? null;
}

function ChatRoleBadge({ message, channel, author }: MessageDecorationProps) {
    const { badges, showInChat } = settings.use(["badges", "showInChat"]);

    const guildId = channel?.guild_id;
    const roleId = useStateFromStores(
        [GuildMemberStore, GuildRoleStore],
        () => getTopBadgeRoleId(guildId, message?.author?.id),
        [guildId, message?.author?.id, badges.map(b => `${b.guildId}/${b.roleId}/${!!b.url}`).join()]
    );

    if (!showInChat || !guildId || !roleId) return null;

    // Discord already renders the icon of the member's icon role next to the name, and getRoleIconData returns ours for it
    if (author?.iconRoleId === roleId && GuildStore.getGuild(guildId)?.features.has(ROLE_ICONS_FEATURE)) return null;

    const badge = findBadge(roleId, guildId);
    const role = GuildRoleStore.getRole(guildId, roleId);
    if (!badge || !role) return null;

    return (
        <span className={cl("chat")}>
            <RoleIconComponent
                className={roleIconClass}
                name={role.name}
                size={20}
                src={badge.url}
            />
        </span>
    );
}

// endregion

// region Settings

function BadgeInput({ value, placeholder, onChange, error }: {
    value: string;
    placeholder: string;
    onChange(value: string): void;
    error?: boolean;
}) {
    return (
        <div className={cl("input", error && "input-error")}>
            <TextInput
                placeholder={placeholder}
                value={value}
                onChange={(v: string) => onChange(v.trim())}
                spellCheck={false}
            />
        </div>
    );
}

function BadgeRow({ badge, onChange, onClone, onRemove }: {
    badge: RoleBadge;
    onChange(key: "guildId" | "roleId" | "url", value: string): void;
    onClone(): void;
    onRemove(): void;
}) {
    const [imageError, setImageError] = useState(false);

    const guild = badge.guildId ? GuildStore.getGuild(badge.guildId) : undefined;
    const role = badge.guildId && badge.roleId ? GuildRoleStore.getRole(badge.guildId, badge.roleId) : undefined;

    const guildIdError = !!badge.guildId && !SNOWFLAKE_RE.test(badge.guildId);
    const roleIdError = !!badge.roleId && !SNOWFLAKE_RE.test(badge.roleId);
    const urlError = !!badge.url && (!/^(https?:|data:image\/)/.test(badge.url) || imageError);

    const hints = [
        guild ? `Server: ${guild.name}` : badge.guildId && !guildIdError && "Server not found",
        role ? `Role: ${role.name}` : guild && badge.roleId && !roleIdError && "Role not found in this server"
    ].filter(Boolean);

    return (
        <div className={cl("row")}>
            <div className={cl("fields")}>
                <BadgeInput
                    placeholder="Server ID"
                    value={badge.guildId}
                    onChange={v => onChange("guildId", v)}
                    error={guildIdError}
                />
                <BadgeInput
                    placeholder="Role ID"
                    value={badge.roleId}
                    onChange={v => onChange("roleId", v)}
                    error={roleIdError}
                />
                <BadgeInput
                    placeholder="Image URL"
                    value={badge.url}
                    onChange={v => {
                        setImageError(false);
                        onChange("url", v);
                    }}
                    error={urlError}
                />
                <div className={cl("preview")}>
                    {badge.url && !urlError && (
                        <img src={badge.url} alt="" onError={() => setImageError(true)} />
                    )}
                </div>
                <Button size="small" variant="secondary" onClick={onClone}>Clone</Button>
                <Button size="small" variant="dangerSecondary" onClick={onRemove}>Delete</Button>
            </div>
            {hints.length > 0 && (
                <Paragraph size="xs" className={cl("hint")}>{hints.join(" · ")}</Paragraph>
            )}
            {urlError && (
                <Paragraph size="xs" className={cl("error")}>
                    {imageError ? "The image could not be loaded" : "The URL must start with http(s):// or data:image/"}
                </Paragraph>
            )}
        </div>
    );
}

function BadgesEditor() {
    const { badges } = settings.use(["badges"]);

    const update = (mutate: () => void) => {
        mutate();
        syncRoleIconsFeature();
    };

    return (
        <div className={cl("editor")}>
            <Paragraph size="sm">
                Set a custom role icon for specific roles. The icon is shown before the role name in the server and user role lists, and after the username in chat. Only you can see it.
            </Paragraph>
            {badges.map((badge, i) => (
                <BadgeRow
                    key={badge.id}
                    badge={badge}
                    onChange={(key, value) => update(() => { badges[i][key] = value; })}
                    onClone={() => update(() => { badges.splice(i + 1, 0, makeBadge(badge.guildId, badge.roleId, badge.url)); })}
                    onRemove={() => update(() => { badges.splice(i, 1); })}
                />
            ))}
            <div>
                <Button size="small" onClick={() => update(() => { badges.push(makeBadge()); })}>Add role</Button>
            </div>
        </div>
    );
}

// endregion

export default definePlugin({
    name: "CustomRoleBadge",
    description: "Set custom (client side) role icons for specific roles in specific servers, as if the server had the boost perk",
    tags: ["Appearance", "Roles"],
    authors: [{ name: "centoventotto", id: 838808975558311948n }],
    dependencies: ["MessageDecorationsAPI"],
    settings,

    patches: [
        {
            // getRoleIconData, the only place building a {customIconSrc} object. The fallback in start() covers it if this breaks
            find: "customIconSrc",
            all: true,
            noWarn: true,
            replacement: {
                match: /(?:function \i|\i=)\((\i),\i\)(?:=>)?\{(?=(?:(?!function|=>).){0,200}?(?:return ?|[?:])\{customIconSrc:)/,
                replace: "$&{const vcCustomRoleBadge=$self.getCustomIconData($1);if(vcCustomRoleBadge!=null)return vcCustomRoleBadge;}"
            }
        }
    ],

    getCustomIconData,

    renderMessageDecoration: ChatRoleBadge,

    start() {
        overrideRoleIconDataExport();
        syncRoleIconsFeature();
        GuildStore.addChangeListener(syncRoleIconsFeature);
    },

    stop() {
        GuildStore.removeChangeListener(syncRoleIconsFeature);
        unspoofAll();
        restoreExports.splice(0).forEach(restore => restore());
    }
});
