package com.tkl.erp.auth.web;

import com.tkl.erp.auth.security.AuthPrincipal;
import com.tkl.erp.auth.service.AuthService;
import com.tkl.erp.auth.web.dto.ChangePasswordRequest;
import com.tkl.erp.auth.web.dto.LoginRequest;
import com.tkl.erp.auth.web.dto.UpdateProfileRequest;
import jakarta.validation.Valid;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/auth")
public class AuthController {

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/login")
    public Object login(@Valid @RequestBody LoginRequest request) {
        return authService.login(request);
    }

    @GetMapping("/profile")
    public Object profile(@AuthenticationPrincipal AuthPrincipal principal) {
        return authService.profile(principal.userId());
    }

    @PutMapping("/profile")
    public Object updateProfile(
            @AuthenticationPrincipal AuthPrincipal principal,
            @Valid @RequestBody UpdateProfileRequest request
    ) {
        return authService.updateProfile(principal.userId(), request);
    }

    @PutMapping("/password")
    public Object changePassword(
            @AuthenticationPrincipal AuthPrincipal principal,
            @Valid @RequestBody ChangePasswordRequest request
    ) {
        return authService.changePassword(principal.userId(), request);
    }
}
