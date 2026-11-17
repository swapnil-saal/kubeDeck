---
title: "Users and roles"
description: "Create accounts, choose who is an admin, reset passwords and block people in KubeDeck's web mode."
---

# Users and roles

In web mode, KubeDeck signs people in itself. An admin creates every account: there is no sign-up page. Each account has a role, admin or user, and belongs to groups that decide its access. This page covers accounts and roles; [Groups and cluster access](/web/groups) covers what groups give.

## The first admin

On start, KubeDeck creates the account named by `KUBEDECK_ADMIN_EMAIL` with the password in `KUBEDECK_ADMIN_PASSWORD`, as an admin. It does this only when no account has that email. It never changes an existing account, so you can leave the variables set.

| Situation | What the log says |
|---|---|
| The account was created | `Created the first admin, admin@example.com. Sign in and add users under Settings → Users.` |
| No accounts, no admin email | `No users yet. Set KUBEDECK_ADMIN_EMAIL and KUBEDECK_ADMIN_PASSWORD to create the first admin.` |
| Email set, password missing | `admin@example.com does not exist yet: set KUBEDECK_ADMIN_PASSWORD to create it.` |

The first admin starts with no cluster access. After signing in, add clusters in [Settings → Clusters](/web/clusters), create groups with service accounts on them in [Settings → Groups](/web/groups), then add people to the groups, yourself included.

## Roles

| | Admin | User |
|---|---|---|
| Settings → Clusters, Users, Groups, Audit log | Yes | Hidden |
| AI provider and plugins | Changes them | Uses them |
| KubeDeck permissions (palette, assistant, pod files…) | All of them, always | Those any of their groups allows. None without a group. |
| Identity on a cluster one of their groups covers | Their groups' service accounts there | Their groups' service accounts there |
| Identity on a cluster no group of theirs covers | No access | No access |

::: callout warning title:"Admins reach clusters through groups too"
Being an admin gives no cluster access. To see a cluster, an admin needs a group with a service account on it, like everyone else. But an admin can put themselves in any group and change what a group's service account may do where the cluster's connection allows it. Make someone an admin only if you trust them with that.
:::

## Add a person

::: steps
::: step "Open Settings → Users"
Only admins see it. Choose **Add person**.
::: /step
::: step "Fill in the details"
- **Name**, **Email**.
- **Password**: at least 12 characters. **Generate** makes a random one, and the copy button copies it.
- **KubeDeck role**: **User**, or **Admin: also manages users**.
::: /step
::: step "Pick their groups"
An account can be in groups defined under **Settings → Groups** only. **Cluster access** then shows, for every cluster in **Settings → Clusters**, the service accounts they will use there and through which group, or **no access**. **KubeDeck permissions** shows the features they get.
::: /step
::: step "Save and hand over the password"
Choose **Add person**. Give them the password: they can sign in at once.
::: /step
::: /steps

The email is stored in lowercase and cannot be changed later. To change it, add a new account and delete the old one.

## Change an account

Open someone from the list. You can change their name, role and groups, then **Save changes**. Changes apply on their next request.

The **Account** section acts at once:

| Action | What it does |
|---|---|
| **Set a new password** | Sets a password of 12 or more characters. Their sessions stay signed in. |
| **Sign out everywhere** | Ends all of their sessions. |
| **Block sign-in** / **Unblock sign-in** | A blocked account is signed out at once and cannot sign in. |
| **Delete account** | Removes the account. The audit log keeps what they did. |

You cannot remove your own admin role, block yourself or delete yourself. Ask another admin.

## Find people

The list filters by name or email, by **All**, **Admins** or **Blocked**, and by group. Each row shows the person's groups, role and status.

## Sign-in and sessions

- People sign in with their email and password. There is no password reset by email: an admin sets a new one.
- Sessions last 12 hours and are extended while in use, at most once an hour.
- Sign-in is rate limited per address: 10 attempts a minute. Behind a proxy, set `KUBEDECK_PROXY_HOPS` so each person has their own limit.
- With `KUBEDECK_ALLOWED_GROUPS` set, someone in none of those groups gets `Your account is not in a group that may use KubeDeck.` This includes admins.
