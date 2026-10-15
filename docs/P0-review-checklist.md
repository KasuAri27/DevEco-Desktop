# P0 review checklist

All steps start with the Desktop app only. Do not start a CLI first. Use a test Provider/key if you do not want to alter a real account. Provider refresh and the checks below avoid model requests; submitting a task to a real provider may incur a charge.

## 1. Start and check the local environment

1. In `D:\IDE\DevEco Desktop`, run `npm start`.
2. The first-use sheet should open and show cached toolchain detection. Confirm Node.js, DevEco Code Agent, `devecocli`, Studio, and SDK each show a path, version, and compatibility state.
3. Use **重新检测** to refresh versions. If a detected path is wrong, select the correct Agent/Node/Studio/SDK path and confirm Desktop restarts its own idle backend/session. No separate terminal should be required.

Expected: Node 22+, a compatible DevEco Code Agent and its bundled CLI; Studio 6.1+ and an SDK matching the project for signing/build workflows. Node path changes should affect subprocess `PATH` after restart.

## 2. Take the third-party route without Huawei

1. Open **Provider** from the first-use sheet.
2. Pick a native catalog Provider and choose **设置 API Key**, or add an unoccupied custom OpenAI-compatible Provider with endpoint, model ID, context/output limits, tools support, and a test API Key.
3. Save, then refresh the model directory.

Expected: saved credentials show only their type/presence. No secret is echoed. Refresh reports that it did not validate a remote key or make a model request. Native Provider SDK definitions remain unchanged by the custom editor.

## 3. Read and accept the current agreement

1. Open **协议与隐私** and read both official links.
2. The agreement version/state should match the current core response. Select the explicit consent checkbox and press **提交我的同意**.
3. If the product agreement is absent or a current-session Huawei service agreement needs review, try to submit a task before accepting.

Expected: Desktop asks for current consent and does not send the prompt. After the user accepts, Desktop rereads the agreement. A later product-version change should reopen this panel on startup or block the next prompt until reviewed. Third-party Provider use still requires the current product agreement, but does not require Huawei login.

## 4. Save a model and workspace

1. Open **配置中心**, choose the global or current-project scope, and set the default model from the model suggestions.
2. For project scope, choose a HarmonyOS project and verify source labels for project overrides and inherited values. Change one field, save, then reload the configuration.
3. Choose the HarmonyOS project in the first-use sheet.
4. Complete setup.

Expected: only changed fields are saved. Project settings stay inside the selected directory, global credentials are not copied into project files, the backend confirms readback, and an idle session reloads. First-use completion stays blocked until the runtime, agreement, workspace, and default model meet readiness checks.

## 5. Check model variants and session recovery

1. Open a session and inspect the model menu and thinking slider.
2. Switch models with different variants; select a lower/highest available effort; switch to a model with no thought-level variants.
3. Close/reopen Desktop or use **恢复 Agent 会话**.

Expected: the slider follows the selected model’s returned variants, `default`/`auto` does not masquerade as the highest reasoning tier, and a model without variants disables the slider. Recovery uses `session/load` only if the Agent advertises that capability. It must not replay the previous prompt.

## 6. Review privacy controls

1. In **协议与隐私**, inspect the account-level experience-improvement choice.
2. Change the two device-level switches separately: anonymous analytics and crash uploads.
3. Save each preference and read it again.

Expected: the account-level choice is stored per Huawei account and starts off for an account with no decision. Device-level switches reflect native core defaults (on) and are stored separately. Neither control is described as disabling all network traffic.

## 7. Optional Huawei account acceptance

Only do this if you intend to use the built-in DevEco model. The implementation run did not log into or log out of a real account.

1. Open **账号与开发者** and choose **使用 Huawei ID 登录**. Confirm that the system browser opens from Desktop.
2. Use **取消授权** during an authorization if you want to check cancellation, or complete the official authorization and return.
3. Refresh account status. If testing real-name flow, use **打开 Huawei 官方认证页**, complete the Huawei-side action yourself, then choose **认证后重新核验**.
4. Inspect the developer/team check separately. Do not use any certificate-generation action; this Desktop P0 flow does not generate signing materials.
5. Use **退出登录** only if you intend to remove the account from DevEco Code.

Expected: login, cached real-name metadata, team membership, and signing prerequisites appear as separate states. A cached metadata entry alone must not be reported as a fresh or valid login. A generic CLI “Not logged in” result must not be presented as proof the token expired. Cancel must invoke the core OAuth cancel route; timeout is 10 minutes. Huawei service review is required only for the built-in model path.

## 8. Report a mismatch

Include the screen/panel, action just taken, status text/category, runtime version, and whether an OAuth flow was active. Environment & Diagnostics can show redacted stderr and process status. Do not include API keys, authorization codes, token files, or screenshots containing them.
