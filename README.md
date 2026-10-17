# CustomRoleBadge

An [Equicord](https://github.com/Equicord/Equicord) plugin that lets you set a **custom role icon** for specific roles in specific servers, as if the server actually had the boost perk. Everything is **client side**: only you can see it.

The icon is shown:

- before the role name in the **server's role list** (Server Settings → Roles)
- before the role name in the **user's roles** (profile / popout)
- after the **username in chat**

## Installation

1. Clone Equicord and install its dependencies ([official guide](https://docs.equicord.org/building)).
2. Download `customRoleBadge.zip` from the [latest release](../../releases/latest) and extract it into `Equicord/src/userplugins/`, so you end up with:

   ```
   Equicord/src/userplugins/customRoleBadge/index.tsx
   Equicord/src/userplugins/customRoleBadge/styles.css
   ```

3. Build and inject:

   ```sh
   pnpm build
   pnpm inject
   ```

4. Restart Discord and enable **CustomRoleBadge** in the plugin settings.

## Usage

In the plugin settings, fill in each row:

| Field     | Value                                                        |
| --------- | ------------------------------------------------------------ |
| Server ID | The server ID (right click the server → *Copy Server ID*)    |
| Role ID   | The role ID (right click the role → *Copy Role ID*)          |
| Image URL | A direct link to the image (png, gif, webp, …)               |

- **Clone** duplicates the row right below it, so you don't have to type the server ID again: just change the role and the image.
- **Delete** removes the row, **Add role** adds an empty one.
- Under each row you'll see the name of the matched server and role and a preview of the image; invalid fields turn red.

To copy IDs you need to enable *Developer Mode* in Discord (Settings → Advanced).

### Options

- **Spoof Role Icons Feature** (on by default): makes Discord think the configured servers have the "Role Icons" boost perk. This is needed for Discord to show the icons in role lists. Side effect: you'll also see the server's *real* role icons, if it had any set (just like if it were boosted).
- **Show In Chat**: shows the icon after the username in messages. If a user has several configured roles, the icon of the highest one is shown.

## How it works

- Every role icon in the role lists goes through Discord's internal `getRoleIconData(role, size)` function. The plugin patches it to return the custom image for the configured roles; if the patch breaks after a Discord update, a fallback overrides the module export instead.
- In chat the icon is added with Equicord's `MessageDecorationsAPI`, using Discord's own `RoleIcon` component.

## Author

centoventotto (Discord ID `838808975558311948`)

## License

Released under the [GNU General Public License v3.0](LICENSE), like Equicord itself.
