<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { User, Phone, Message, Lock } from '@element-plus/icons-vue'
import { authApi } from '@/api/client.js'
import { fmtTime } from '@/api/mappers.ts'
import { useAppStore } from '@/stores/app'

const app = useAppStore()

const loading = ref(true)
const profileSaving = ref(false)
const passwordSaving = ref(false)

const profile = ref({
  username: '',
  realName: '',
  phone: '',
  email: '',
  roleName: '',
  roleCode: '',
  lastLoginAt: null as string | null,
})

const profileForm = ref({
  realName: '',
  phone: '',
  email: '',
})

const passwordForm = ref({
  oldPassword: '',
  newPassword: '',
  confirmPassword: '',
})

const userInitial = computed(() => profileForm.value.realName?.charAt(0) || profile.value.username?.charAt(0) || '?')
const roleLabel = computed(() => app.currentAccount.role)

async function loadProfile() {
  loading.value = true
  try {
    const data = await authApi.profile()
    profile.value = {
      username: data.username || '',
      realName: data.realName || '',
      phone: data.phone || '',
      email: data.email || '',
      roleName: data.roleName || '',
      roleCode: data.roleCode || '',
      lastLoginAt: data.lastLoginAt || null,
    }
    profileForm.value = {
      realName: data.realName || '',
      phone: data.phone || '',
      email: data.email || '',
    }
  } catch (e: any) {
    ElMessage.error(e?.message || '加载个人信息失败')
  } finally {
    loading.value = false
  }
}

async function saveProfile() {
  const name = profileForm.value.realName.trim()
  if (!name) {
    ElMessage.warning('请填写姓名')
    return
  }
  profileSaving.value = true
  try {
    const updated = await authApi.updateProfile({
      realName: name,
      phone: profileForm.value.phone.trim(),
      email: profileForm.value.email.trim(),
    })
    app.applyProfile(updated)
    profile.value.realName = updated.realName
    profile.value.phone = updated.phone || ''
    profile.value.email = updated.email || ''
    ElMessage.success('基本信息已保存')
  } catch (e: any) {
    ElMessage.error(e?.message || '保存失败')
  } finally {
    profileSaving.value = false
  }
}

async function savePassword() {
  const { oldPassword, newPassword, confirmPassword } = passwordForm.value
  if (!oldPassword) {
    ElMessage.warning('请输入当前密码')
    return
  }
  if (!newPassword || newPassword.length < 6) {
    ElMessage.warning('新密码至少 6 位')
    return
  }
  if (newPassword !== confirmPassword) {
    ElMessage.warning('两次输入的新密码不一致')
    return
  }
  passwordSaving.value = true
  try {
    await authApi.changePassword({ oldPassword, newPassword })
    passwordForm.value = { oldPassword: '', newPassword: '', confirmPassword: '' }
    ElMessage.success('密码已修改')
  } catch (e: any) {
    ElMessage.error(e?.message || '修改密码失败')
  } finally {
    passwordSaving.value = false
  }
}

onMounted(loadProfile)
</script>

<template>
  <div class="profile-settings-page" v-loading="loading">
    <div class="profile-hero">
      <div class="profile-hero-avatar">{{ userInitial }}</div>
      <div class="profile-hero-meta">
        <h1>{{ profileForm.realName || profile.username }}</h1>
        <p class="profile-hero-login">@{{ profile.username }}</p>
        <div class="profile-hero-tags">
          <span class="role-tag">{{ roleLabel }}</span>
          <span v-if="profile.lastLoginAt" class="login-tag">最近登录 {{ fmtTime(profile.lastLoginAt) }}</span>
        </div>
      </div>
    </div>

    <div class="settings-grid">
      <el-card class="settings-card">
        <template #header>
          <div class="card-head">
            <div>
              <div class="card-title">基本信息</div>
              <div class="card-desc">更新您的姓名与联系方式，登录名与角色由管理员维护</div>
            </div>
          </div>
        </template>

        <el-form label-position="top" class="settings-form" @submit.prevent="saveProfile">
          <el-row :gutter="20">
            <el-col :xs="24" :sm="12">
              <el-form-item label="登录名">
                <el-input :model-value="profile.username" disabled :prefix-icon="User" />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12">
              <el-form-item label="角色">
                <el-input :model-value="roleLabel" disabled />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12">
              <el-form-item label="姓名" required>
                <el-input v-model="profileForm.realName" placeholder="请输入姓名" :prefix-icon="User" />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12">
              <el-form-item label="手机">
                <el-input v-model="profileForm.phone" placeholder="选填" :prefix-icon="Phone" />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12">
              <el-form-item label="邮箱">
                <el-input v-model="profileForm.email" placeholder="选填" :prefix-icon="Message" />
              </el-form-item>
            </el-col>
          </el-row>

          <div class="form-actions">
            <el-button type="primary" :loading="profileSaving" @click="saveProfile">保存基本信息</el-button>
          </div>
        </el-form>
      </el-card>

      <el-card class="settings-card">
        <template #header>
          <div class="card-head">
            <div>
              <div class="card-title">修改密码</div>
              <div class="card-desc">定期更换密码有助于保护账号安全</div>
            </div>
          </div>
        </template>

        <el-form label-position="top" class="settings-form" @submit.prevent="savePassword">
          <el-form-item label="当前密码">
            <el-input
              v-model="passwordForm.oldPassword"
              type="password"
              show-password
              placeholder="请输入当前密码"
              :prefix-icon="Lock"
              autocomplete="current-password"
            />
          </el-form-item>
          <el-row :gutter="20">
            <el-col :xs="24" :sm="12">
              <el-form-item label="新密码">
                <el-input
                  v-model="passwordForm.newPassword"
                  type="password"
                  show-password
                  placeholder="至少 6 位"
                  :prefix-icon="Lock"
                  autocomplete="new-password"
                />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12">
              <el-form-item label="确认新密码">
                <el-input
                  v-model="passwordForm.confirmPassword"
                  type="password"
                  show-password
                  placeholder="再次输入新密码"
                  :prefix-icon="Lock"
                  autocomplete="new-password"
                />
              </el-form-item>
            </el-col>
          </el-row>

          <div class="form-actions">
            <el-button type="primary" plain :loading="passwordSaving" @click="savePassword">更新密码</el-button>
          </div>
        </el-form>
      </el-card>
    </div>
  </div>
</template>

<style scoped>
.profile-settings-page {
  max-width: 960px;
  margin: 0 auto;
}

.profile-hero {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 24px 28px;
  margin-bottom: 20px;
  background: var(--panel-solid);
  border: 1px solid var(--border);
  border-radius: 16px;
  box-shadow: 0 16px 44px rgba(0, 0, 0, 0.18);
}

.profile-hero-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 72px;
  border-radius: 18px;
  background: linear-gradient(145deg, #6366f1, #8b5cf6);
  color: #fff;
  font-size: 28px;
  font-weight: 600;
  box-shadow: 0 8px 24px rgba(99, 102, 241, 0.3);
  flex-shrink: 0;
}

.profile-hero-meta h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
  color: var(--text);
  line-height: 1.3;
}

.profile-hero-login {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--text-muted);
}

.profile-hero-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.role-tag {
  display: inline-block;
  padding: 3px 10px;
  font-size: 12px;
  font-weight: 500;
  color: var(--primary);
  background: var(--panel-soft);
  border: 1px solid var(--border);
  border-radius: 999px;
}

.login-tag {
  display: inline-block;
  padding: 3px 10px;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--panel-soft);
  border: 1px solid var(--border);
  border-radius: 999px;
}

.settings-grid {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.settings-card :deep(.el-card__header) {
  padding: 16px 20px;
}

.settings-card :deep(.el-card__body) {
  padding: 8px 20px 20px;
}

.card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.card-title {
  font-size: 15px;
  font-weight: 600;
  color: #e2e8f0;
}

.card-desc {
  margin-top: 4px;
  font-size: 12px;
  color: #718096;
  line-height: 1.5;
}

.settings-form {
  max-width: 640px;
}

.form-actions {
  margin-top: 8px;
  padding-top: 8px;
}

@media (max-width: 640px) {
  .profile-hero {
    flex-direction: column;
    align-items: flex-start;
    padding: 20px;
  }

  .profile-hero-avatar {
    width: 56px;
    height: 56px;
    font-size: 22px;
    border-radius: 14px;
  }
}
</style>
