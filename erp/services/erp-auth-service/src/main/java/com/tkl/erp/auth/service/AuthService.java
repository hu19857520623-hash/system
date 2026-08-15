package com.tkl.erp.auth.service;

import com.tkl.erp.auth.domain.SysUser;
import com.tkl.erp.auth.permission.PermissionService;
import com.tkl.erp.auth.repository.SysRoleRepository;
import com.tkl.erp.auth.repository.SysUserRepository;
import com.tkl.erp.auth.security.AuthPrincipal;
import com.tkl.erp.auth.security.JwtTokenService;
import com.tkl.erp.auth.web.dto.*;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.Map;

@Service
public class AuthService {

    private final SysUserRepository userRepository;
    private final SysRoleRepository roleRepository;
    private final PermissionService permissionService;
    private final JwtTokenService jwtTokenService;
    private final PasswordEncoder passwordEncoder;

    public AuthService(
            SysUserRepository userRepository,
            SysRoleRepository roleRepository,
            PermissionService permissionService,
            JwtTokenService jwtTokenService,
            PasswordEncoder passwordEncoder
    ) {
        this.userRepository = userRepository;
        this.roleRepository = roleRepository;
        this.permissionService = permissionService;
        this.jwtTokenService = jwtTokenService;
        this.passwordEncoder = passwordEncoder;
    }

    @Transactional
    public LoginResponse login(LoginRequest request) {
        SysUser user = userRepository.findByUsername(request.username())
                .orElseThrow(() -> unauthorized("用户名或密码错误"));

        if (user.getStatus() == null || user.getStatus() != 1) {
            throw unauthorized("账号已被禁用");
        }

        if (!passwordEncoder.matches(request.password(), user.getPasswordHash())) {
            throw unauthorized("用户名或密码错误");
        }

        user.setLastLoginAt(Instant.now());
        userRepository.save(user);

        return buildAuthResponse(user);
    }

    public ProfileResponse profile(Long userId) {
        SysUser user = userRepository.findById(userId)
                .orElseThrow(() -> unauthorized("用户不存在"));

        String roleName = roleRepository.findByRoleCode(user.getRoleCode())
                .map(role -> role.getRoleName())
                .orElse(user.getRoleCode());

        var permissions = permissionService.getUserPermissions(user.getId(), user.getRoleCode());

        return new ProfileResponse(
                user.getId(),
                user.getUsername(),
                user.getRealName(),
                user.getPhone(),
                user.getEmail(),
                user.getAvatarUrl(),
                user.getRoleCode(),
                roleName,
                user.getLastLoginAt(),
                permissions
        );
    }

    @Transactional
    public ProfileResponse updateProfile(Long userId, UpdateProfileRequest request) {
        SysUser user = userRepository.findById(userId)
                .orElseThrow(() -> unauthorized("用户不存在"));

        if (request.realName() != null) {
            String name = request.realName().trim();
            if (name.isEmpty()) {
                throw badRequest("姓名不能为空");
            }
            user.setRealName(name);
        }
        if (request.phone() != null) {
            user.setPhone(request.phone().trim().isEmpty() ? null : request.phone().trim());
        }
        if (request.email() != null) {
            user.setEmail(request.email().trim().isEmpty() ? null : request.email().trim());
        }

        userRepository.save(user);
        return profile(userId);
    }

    @Transactional
    public Map<String, Boolean> changePassword(Long userId, ChangePasswordRequest request) {
        SysUser user = userRepository.findById(userId)
                .orElseThrow(() -> unauthorized("用户不存在"));

        if (!passwordEncoder.matches(request.oldPassword(), user.getPasswordHash())) {
            throw unauthorized("当前密码不正确");
        }

        user.setPasswordHash(passwordEncoder.encode(request.newPassword()));
        userRepository.save(user);
        return Map.of("ok", true);
    }

    private LoginResponse buildAuthResponse(SysUser user) {
        var permissions = permissionService.getUserPermissions(user.getId(), user.getRoleCode());
        var principal = new AuthPrincipal(
                user.getId(),
                user.getUsername(),
                user.getRoleCode(),
                user.getRealName()
        );
        String token = jwtTokenService.createToken(principal);
        var authUser = new AuthUserDto(
                user.getId(),
                user.getUsername(),
                user.getRealName(),
                user.getRoleCode(),
                user.getAvatarUrl(),
                permissions
        );
        return new LoginResponse(token, authUser);
    }

    private static ResponseStatusException unauthorized(String message) {
        return new ResponseStatusException(HttpStatus.UNAUTHORIZED, message);
    }

    private static ResponseStatusException badRequest(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }
}
