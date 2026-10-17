# To Do List: setup guide

Do this once, on a laptop, at home. Allow 30–60 minutes. You won't need to write any code, only copy and paste.

Menu names on GitHub and Supabase change from time to time. If a button isn't exactly where this guide says, look for the closest match.

**Keep these two files separate:**
- **todo-app.zip** is the app. It goes on GitHub, which is public.
- **my-tasks-import.json** holds your current tasks. **Never upload it to GitHub.** You'll import it into the app in step 8.

---

## 1. Create two free accounts

1. **GitHub**: go to github.com and sign up. Your username becomes part of the app's address, for example `yourname.github.io`.
2. **Supabase**: go to supabase.com and sign up. You can use "Continue with GitHub".

## 2. Put the app on GitHub Pages

1. Unzip **todo-app.zip** on your laptop.
2. On GitHub, click **+** (top right) and then **New repository**. Name it `todo`, set it to **Public**, and click **Create repository**.
3. On the next page, click **uploading an existing file**. Drag in **everything inside** the unzipped `todo-app` folder, including the `icons` and `supabase` folders. Click **Commit changes**.
4. Go to **Settings** and then **Pages**. Under "Build and deployment", set **Source** to **Deploy from a branch**, the branch to **main**, and the folder to **/ (root)**. Click **Save**.
5. After a minute or two, the page shows your address, for example `https://yourname.github.io/todo/`. Write it down. This is **your app address**.

## 3. Create the Supabase project

1. In Supabase, click **New project**. Name it `todo`, choose a strong database password (save it in your password manager), and pick the region closest to you, for example **London**. Click **Create**, then wait a couple of minutes.
2. Open **SQL Editor** in the left menu and click **New query**.
3. Open `supabase/1-schema.sql` from the unzipped folder, copy everything, paste it in, and click **Run**. You should see "Success".

## 4. Make your keys and fill in config.js

1. Open `https://yourname.github.io/todo/keys.html`, using your app address with `keys.html` on the end. Keep this tab open until step 7.
2. In Supabase, open **Project Settings** and then **API** (it may be called **Data API** or **API Keys**). Find:
   - the **Project URL**, which looks like `https://abcdefgh.supabase.co`
   - the **anon / public** key, a long string. Don't use the "service_role" or secret key.
3. On GitHub, open your `todo` repository, click **config.js**, then the **pencil** icon to edit it. Replace:
   - `https://YOUR-PROJECT.supabase.co` with your Project URL
   - `YOUR-ANON-PUBLIC-KEY` with the anon public key
   - `YOUR-VAPID-PUBLIC-KEY` with the **VAPID public key** from the keys page

   Keep the quote marks. Click **Commit changes**.

These three values are designed to be public, so it's safe for them to be on GitHub.

## 5. Tell Supabase your app address

In Supabase, go to **Authentication**, then **URL Configuration**:
- Set **Site URL** to your app address, for example `https://yourname.github.io/todo/`.
- Under **Redirect URLs**, add the same address and click **Save**.

This makes the sign-up confirmation and password reset emails link back to your app.

## 6. Add the reminder sender

1. In Supabase, open **Edge Functions**, then **Deploy a new function**, then **Via Editor**.
2. Name it exactly `tick`.
3. Delete the sample code. Open `supabase/functions/tick/index.ts` from the unzipped folder, copy everything, paste it in, and click **Deploy**.
4. Open the function's **Settings** (or **Details**) and **turn off "Enforce JWT verification"**, also called "Verify JWT". Save. The function checks its own secret instead.
5. Go to **Edge Functions** and then **Secrets**. Add these four, copying the values from the keys page:

   | Name | Value |
   |---|---|
   | `VAPID_PUBLIC_KEY` | VAPID public key |
   | `VAPID_PRIVATE_KEY` | VAPID private key |
   | `CRON_SECRET` | Cron secret |
   | `VAPID_SUBJECT` | `mailto:` followed by your email, for example `mailto:you@outlook.com` |

## 7. Run the reminder check every minute

1. Open `supabase/2-schedule.sql` in a text editor such as Notepad.
2. Replace `YOUR-PROJECT` with the part of your Project URL before `.supabase.co`. For `https://abcdefgh.supabase.co`, that's `abcdefgh`.
3. Replace `YOUR-CRON-SECRET` with the cron secret from the keys page.
4. Copy all of it into a **new query** in Supabase's **SQL Editor** and click **Run**.

You can close the keys page now.

## 8. Sign up and bring your tasks across

1. Open your app address. Enter your email and a password of 8 or more characters, then tap **Create account**.
2. Open the confirmation email from Supabase and click the link. It brings you back to the app. Sign in.
3. Tap **⚙** (top right), then **Import file**, and choose **my-tasks-import.json**. Your lists, tasks and recurring tasks appear. Delete the "Example:" tasks whenever you like.

## 9. Install on each device and turn on reminders

**Samsung phone (Chrome):** open your app address, tap **⋮** and then **Add to home screen**, and choose **Install**. Open the app from your home screen, sign in, tap **⚙**, then **Turn on for this device**, and allow notifications. Then tap **Send test**.

**Windows laptops (Chrome or Edge):** open your app address. Click the **install icon** in the address bar (a screen with an arrow), or open the menu and choose **Apps** and then **Install**. Sign in, then **⚙**, **Turn on for this device**, and **Send test**.

**iPad (Safari, iPadOS 16.4 or later):** open your app address, tap **Share** and then **Add to Home Screen**. Open it from the home screen (notifications only work this way on iPad), sign in, then **⚙**, **Turn on for this device**, and **Send test**.

**Samsung tip:** if reminders arrive late, go to **Settings**, then **Apps**, then **Chrome**, then **Battery**, and choose **Unrestricted**. Samsung's battery saver can delay notifications.

## 10. Test at school

On the school network, open your app address and sign in, then tap **⚙** and **Send test**.
- **Tasks load and the test arrives:** everything works.
- **Tasks load but no test arrives:** the school blocks browser notifications. Your phone still gets reminders, and the laptop shows them while the app is open.
- **Sign-in fails:** Supabase is blocked. Tell me what you see.

---

## If something goes wrong

- **The app page is blank:** check `config.js` on GitHub. Each value needs quote marks around it, and there should be no extra spaces.
- **"Invalid API key" when signing in:** you used the wrong key. Use the **anon / public** one.
- **Send test says it couldn't be sent:** check step 6. The four secrets must be named exactly as shown, and JWT verification must be off.
- **The test works but reminders don't:** check step 7. In Supabase, open **Integrations** and then **Cron** (or **Database** and then **Cron Jobs**) to see whether `todo-tick` is running.
- **Changing the app later:** edit the files on GitHub. Each device picks up the new version the next time it opens the app.
