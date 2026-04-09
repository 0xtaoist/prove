use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount, Transfer};

declare_id!("PAMM111111111111111111111111111111111111111");

const TRADING_COOLDOWN_SECONDS: i64 = 30;
const FEE_BPS: u64 = 100; // 1% = 100 basis points
const BPS_DENOMINATOR: u64 = 10_000;

#[program]
pub mod prove_amm {
    use super::*;

    /// Creates a new token/SOL pool with initial reserves.
    /// Mints initial LP tokens to the creator.
    /// Trading is disabled for 30 seconds after creation.
    pub fn create_pool(
        ctx: Context<CreatePool>,
        initial_sol: u64,
        initial_tokens: u64,
    ) -> Result<()> {
        require!(initial_sol > 0, AmmError::ZeroAmount);
        require!(initial_tokens > 0, AmmError::ZeroAmount);

        // Transfer SOL from creator to pool vault (system transfer)
        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.creator.to_account_info(),
                    to: ctx.accounts.sol_vault.to_account_info(),
                },
            ),
            initial_sol,
        )?;

        // Transfer tokens from creator to pool token vault
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.creator_token_account.to_account_info(),
                    to: ctx.accounts.token_vault.to_account_info(),
                    authority: ctx.accounts.creator.to_account_info(),
                },
            ),
            initial_tokens,
        )?;

        // Calculate initial LP tokens: sqrt(initial_sol * initial_tokens)
        let k = (initial_sol as u128)
            .checked_mul(initial_tokens as u128)
            .ok_or(AmmError::MathOverflow)?;
        let initial_lp = integer_sqrt(k);
        require!(initial_lp > 0, AmmError::InsufficientLiquidity);

        // Mint initial LP tokens to creator
        let mint_key = ctx.accounts.mint.key();
        let bump = ctx.bumps.pool;
        let seeds = &[b"pool".as_ref(), mint_key.as_ref(), &[bump]];
        let signer_seeds = &[&seeds[..]];

        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.lp_mint.to_account_info(),
                    to: ctx.accounts.creator_lp_account.to_account_info(),
                    authority: ctx.accounts.pool.to_account_info(),
                },
                signer_seeds,
            ),
            initial_lp as u64,
        )?;

        // Initialize pool state
        let pool = &mut ctx.accounts.pool;
        let clock = Clock::get()?;

        pool.mint = ctx.accounts.mint.key();
        pool.token_reserve = initial_tokens;
        pool.sol_reserve = initial_sol;
        pool.lp_supply = initial_lp as u64;
        pool.lp_mint = ctx.accounts.lp_mint.key();
        pool.fee_config = ctx.accounts.fee_config.key();
        pool.trading_enabled = false;
        pool.created_at = clock.unix_timestamp;
        pool.creator = ctx.accounts.creator.key();
        pool.bump = bump;

        msg!(
            "Pool created: mint={}, sol={}, tokens={}, lp={}",
            pool.mint,
            initial_sol,
            initial_tokens,
            pool.lp_supply
        );

        Ok(())
    }

    /// Permissionless crank to enable trading after the 30-second cooldown.
    pub fn enable_trading(ctx: Context<EnableTrading>) -> Result<()> {
        let pool = &mut ctx.accounts.pool;

        require!(!pool.trading_enabled, AmmError::TradingAlreadyEnabled);

        let clock = Clock::get()?;
        let elapsed = clock
            .unix_timestamp
            .checked_sub(pool.created_at)
            .ok_or(AmmError::MathOverflow)?;

        require!(
            elapsed >= TRADING_COOLDOWN_SECONDS,
            AmmError::TradingCooldownActive
        );

        pool.trading_enabled = true;
        msg!("Trading enabled for pool: mint={}", pool.mint);

        Ok(())
    }

    /// Constant-product swap with 1% fee deducted from input.
    /// is_buy = true: SOL in, tokens out.
    /// is_buy = false: tokens in, SOL out.
    pub fn swap(
        ctx: Context<Swap>,
        amount_in: u64,
        is_buy: bool,
        min_amount_out: u64,
    ) -> Result<()> {
        // Read all needed pool state up front before any mutable borrow
        let pool_trading_enabled = ctx.accounts.pool.trading_enabled;
        let pool_mint = ctx.accounts.pool.mint;
        let pool_bump = ctx.accounts.pool.bump;
        let pool_token_reserve = ctx.accounts.pool.token_reserve;
        let pool_sol_reserve = ctx.accounts.pool.sol_reserve;

        require!(pool_trading_enabled, AmmError::TradingNotEnabled);
        require!(amount_in > 0, AmmError::ZeroAmount);

        // Calculate fee: 1% of input
        let fee = amount_in
            .checked_mul(FEE_BPS)
            .ok_or(AmmError::MathOverflow)?
            .checked_div(BPS_DENOMINATOR)
            .ok_or(AmmError::MathOverflow)?;
        let amount_after_fee = amount_in
            .checked_sub(fee)
            .ok_or(AmmError::MathOverflow)?;

        require!(amount_after_fee > 0, AmmError::ZeroAmount);

        // k = token_reserve * sol_reserve (u128 to prevent overflow)
        let k = (pool_token_reserve as u128)
            .checked_mul(pool_sol_reserve as u128)
            .ok_or(AmmError::MathOverflow)?;

        let amount_out: u64;

        if is_buy {
            // SOL in, tokens out
            // Transfer SOL from user to sol_vault
            anchor_lang::system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    anchor_lang::system_program::Transfer {
                        from: ctx.accounts.user.to_account_info(),
                        to: ctx.accounts.sol_vault.to_account_info(),
                    },
                ),
                amount_in,
            )?;

            let new_sol_reserve = (pool_sol_reserve as u128)
                .checked_add(amount_after_fee as u128)
                .ok_or(AmmError::MathOverflow)?;

            let new_token_reserve = k
                .checked_div(new_sol_reserve)
                .ok_or(AmmError::MathOverflow)?;

            amount_out = (pool_token_reserve as u128)
                .checked_sub(new_token_reserve)
                .ok_or(AmmError::MathOverflow)? as u64;

            require!(amount_out > 0, AmmError::InsufficientOutput);
            require!(amount_out >= min_amount_out, AmmError::SlippageExceeded);

            // Transfer tokens from vault to user
            let seeds = &[b"pool".as_ref(), pool_mint.as_ref(), &[pool_bump]];
            let signer_seeds = &[&seeds[..]];

            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.token_vault.to_account_info(),
                        to: ctx.accounts.user_token_account.to_account_info(),
                        authority: ctx.accounts.pool.to_account_info(),
                    },
                    signer_seeds,
                ),
                amount_out,
            )?;

            let pool = &mut ctx.accounts.pool;
            pool.sol_reserve = pool_sol_reserve
                .checked_add(amount_after_fee)
                .ok_or(AmmError::MathOverflow)?;
            pool.token_reserve = pool_token_reserve
                .checked_sub(amount_out)
                .ok_or(AmmError::MathOverflow)?;
        } else {
            // Tokens in, SOL out
            // Transfer tokens from user to token vault
            token::transfer(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.user_token_account.to_account_info(),
                        to: ctx.accounts.token_vault.to_account_info(),
                        authority: ctx.accounts.user.to_account_info(),
                    },
                ),
                amount_in,
            )?;

            let new_token_reserve = (pool_token_reserve as u128)
                .checked_add(amount_after_fee as u128)
                .ok_or(AmmError::MathOverflow)?;

            let new_sol_reserve = k
                .checked_div(new_token_reserve)
                .ok_or(AmmError::MathOverflow)?;

            amount_out = (pool_sol_reserve as u128)
                .checked_sub(new_sol_reserve)
                .ok_or(AmmError::MathOverflow)? as u64;

            require!(amount_out > 0, AmmError::InsufficientOutput);
            require!(amount_out >= min_amount_out, AmmError::SlippageExceeded);

            // Transfer SOL from sol_vault to user via lamport manipulation
            let sol_vault_info = ctx.accounts.sol_vault.to_account_info();
            let user_info = ctx.accounts.user.to_account_info();

            **sol_vault_info.try_borrow_mut_lamports()? = sol_vault_info
                .lamports()
                .checked_sub(amount_out)
                .ok_or(AmmError::MathOverflow)?;
            **user_info.try_borrow_mut_lamports()? = user_info
                .lamports()
                .checked_add(amount_out)
                .ok_or(AmmError::MathOverflow)?;

            // Fee lamports stay in the vault for now.
            // In Phase 3, CPI to FeeRouter will route fee appropriately.

            let pool = &mut ctx.accounts.pool;
            pool.token_reserve = pool_token_reserve
                .checked_add(amount_after_fee)
                .ok_or(AmmError::MathOverflow)?;
            pool.sol_reserve = pool_sol_reserve
                .checked_sub(amount_out)
                .ok_or(AmmError::MathOverflow)?;
        }

        msg!(
            "Swap: is_buy={}, amount_in={}, fee={}, amount_out={}",
            is_buy,
            amount_in,
            fee,
            amount_out
        );

        Ok(())
    }

    /// Add liquidity proportionally to existing reserves.
    /// Mints LP tokens based on the ratio of added SOL to existing SOL reserve.
    pub fn add_liquidity(
        ctx: Context<AddLiquidity>,
        sol_amount: u64,
        max_token_amount: u64,
    ) -> Result<()> {
        // Read pool state up front to avoid borrow conflicts
        let pool_mint = ctx.accounts.pool.mint;
        let pool_bump = ctx.accounts.pool.bump;
        let pool_sol_reserve = ctx.accounts.pool.sol_reserve;
        let pool_token_reserve = ctx.accounts.pool.token_reserve;
        let pool_lp_supply = ctx.accounts.pool.lp_supply;

        require!(sol_amount > 0, AmmError::ZeroAmount);
        require!(pool_sol_reserve > 0, AmmError::InsufficientLiquidity);
        require!(pool_token_reserve > 0, AmmError::InsufficientLiquidity);

        // Calculate proportional token amount required:
        // token_amount = sol_amount * token_reserve / sol_reserve (rounded up)
        let token_amount = (sol_amount as u128)
            .checked_mul(pool_token_reserve as u128)
            .ok_or(AmmError::MathOverflow)?
            .checked_div(pool_sol_reserve as u128)
            .ok_or(AmmError::MathOverflow)? as u64;

        // Add 1 to handle rounding (ensure pool doesn't lose value)
        let token_amount = token_amount
            .checked_add(1)
            .ok_or(AmmError::MathOverflow)?;

        require!(
            token_amount <= max_token_amount,
            AmmError::SlippageExceeded
        );

        // Calculate LP tokens to mint: lp_tokens = sol_amount * lp_supply / sol_reserve
        let lp_tokens = (sol_amount as u128)
            .checked_mul(pool_lp_supply as u128)
            .ok_or(AmmError::MathOverflow)?
            .checked_div(pool_sol_reserve as u128)
            .ok_or(AmmError::MathOverflow)? as u64;

        require!(lp_tokens > 0, AmmError::InsufficientLiquidity);

        // Transfer SOL from provider to sol_vault
        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.provider.to_account_info(),
                    to: ctx.accounts.sol_vault.to_account_info(),
                },
            ),
            sol_amount,
        )?;

        // Transfer tokens from provider to token vault
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.provider_token_account.to_account_info(),
                    to: ctx.accounts.token_vault.to_account_info(),
                    authority: ctx.accounts.provider.to_account_info(),
                },
            ),
            token_amount,
        )?;

        // Mint LP tokens to provider
        let seeds = &[b"pool".as_ref(), pool_mint.as_ref(), &[pool_bump]];
        let signer_seeds = &[&seeds[..]];

        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.lp_mint.to_account_info(),
                    to: ctx.accounts.provider_lp_account.to_account_info(),
                    authority: ctx.accounts.pool.to_account_info(),
                },
                signer_seeds,
            ),
            lp_tokens,
        )?;

        // Update pool state
        let pool = &mut ctx.accounts.pool;
        pool.sol_reserve = pool_sol_reserve
            .checked_add(sol_amount)
            .ok_or(AmmError::MathOverflow)?;
        pool.token_reserve = pool_token_reserve
            .checked_add(token_amount)
            .ok_or(AmmError::MathOverflow)?;
        pool.lp_supply = pool_lp_supply
            .checked_add(lp_tokens)
            .ok_or(AmmError::MathOverflow)?;

        msg!(
            "Liquidity added: sol={}, tokens={}, lp_minted={}",
            sol_amount,
            token_amount,
            lp_tokens
        );

        Ok(())
    }

    /// Remove liquidity by burning LP tokens.
    /// Returns proportional SOL and tokens to the provider.
    pub fn remove_liquidity(
        ctx: Context<RemoveLiquidity>,
        lp_amount: u64,
        min_sol_out: u64,
        min_tokens_out: u64,
    ) -> Result<()> {
        // Read pool state up front to avoid borrow conflicts
        let pool_mint = ctx.accounts.pool.mint;
        let pool_bump = ctx.accounts.pool.bump;
        let pool_sol_reserve = ctx.accounts.pool.sol_reserve;
        let pool_token_reserve = ctx.accounts.pool.token_reserve;
        let pool_lp_supply = ctx.accounts.pool.lp_supply;

        require!(lp_amount > 0, AmmError::ZeroAmount);
        require!(pool_lp_supply > 0, AmmError::InsufficientLiquidity);

        // Calculate proportional amounts:
        // sol_out = lp_amount * sol_reserve / lp_supply
        // tokens_out = lp_amount * token_reserve / lp_supply
        let sol_out = (lp_amount as u128)
            .checked_mul(pool_sol_reserve as u128)
            .ok_or(AmmError::MathOverflow)?
            .checked_div(pool_lp_supply as u128)
            .ok_or(AmmError::MathOverflow)? as u64;

        let tokens_out = (lp_amount as u128)
            .checked_mul(pool_token_reserve as u128)
            .ok_or(AmmError::MathOverflow)?
            .checked_div(pool_lp_supply as u128)
            .ok_or(AmmError::MathOverflow)? as u64;

        require!(sol_out > 0, AmmError::InsufficientOutput);
        require!(tokens_out > 0, AmmError::InsufficientOutput);
        require!(sol_out >= min_sol_out, AmmError::SlippageExceeded);
        require!(tokens_out >= min_tokens_out, AmmError::SlippageExceeded);

        // Burn LP tokens from provider
        token::burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.lp_mint.to_account_info(),
                    from: ctx.accounts.provider_lp_account.to_account_info(),
                    authority: ctx.accounts.provider.to_account_info(),
                },
            ),
            lp_amount,
        )?;

        let seeds = &[b"pool".as_ref(), pool_mint.as_ref(), &[pool_bump]];
        let signer_seeds = &[&seeds[..]];

        // Transfer tokens from vault to provider
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.token_vault.to_account_info(),
                    to: ctx.accounts.provider_token_account.to_account_info(),
                    authority: ctx.accounts.pool.to_account_info(),
                },
                signer_seeds,
            ),
            tokens_out,
        )?;

        // Transfer SOL from sol_vault to provider via lamport manipulation
        let sol_vault_info = ctx.accounts.sol_vault.to_account_info();
        let provider_info = ctx.accounts.provider.to_account_info();

        **sol_vault_info.try_borrow_mut_lamports()? = sol_vault_info
            .lamports()
            .checked_sub(sol_out)
            .ok_or(AmmError::MathOverflow)?;
        **provider_info.try_borrow_mut_lamports()? = provider_info
            .lamports()
            .checked_add(sol_out)
            .ok_or(AmmError::MathOverflow)?;

        // Update pool state
        let pool = &mut ctx.accounts.pool;
        pool.sol_reserve = pool_sol_reserve
            .checked_sub(sol_out)
            .ok_or(AmmError::MathOverflow)?;
        pool.token_reserve = pool_token_reserve
            .checked_sub(tokens_out)
            .ok_or(AmmError::MathOverflow)?;
        pool.lp_supply = pool_lp_supply
            .checked_sub(lp_amount)
            .ok_or(AmmError::MathOverflow)?;

        msg!(
            "Liquidity removed: lp_burned={}, sol_out={}, tokens_out={}",
            lp_amount,
            sol_out,
            tokens_out
        );

        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Account structs
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct CreatePool<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    /// The token mint for this pool.
    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer = creator,
        space = 8 + Pool::INIT_SPACE,
        seeds = [b"pool", mint.key().as_ref()],
        bump,
    )]
    pub pool: Account<'info, Pool>,

    /// LP token mint, authority = pool PDA.
    #[account(
        init,
        payer = creator,
        mint::decimals = 6,
        mint::authority = pool,
        seeds = [b"lp_mint", mint.key().as_ref()],
        bump,
    )]
    pub lp_mint: Account<'info, Mint>,

    /// Pool's token vault (holds the token side of the pair).
    #[account(
        init,
        payer = creator,
        token::mint = mint,
        token::authority = pool,
        seeds = [b"token_vault", mint.key().as_ref()],
        bump,
    )]
    pub token_vault: Account<'info, TokenAccount>,

    /// Pool's SOL vault PDA (holds lamports).
    /// CHECK: This is a PDA used purely as a lamport holder.
    #[account(
        mut,
        seeds = [b"sol_vault", mint.key().as_ref()],
        bump,
    )]
    pub sol_vault: SystemAccount<'info>,

    /// Creator's token account (source of initial tokens).
    #[account(
        mut,
        constraint = creator_token_account.mint == mint.key(),
        constraint = creator_token_account.owner == creator.key(),
    )]
    pub creator_token_account: Account<'info, TokenAccount>,

    /// Creator's LP token account (receives initial LP tokens).
    #[account(
        init,
        payer = creator,
        token::mint = lp_mint,
        token::authority = creator,
        seeds = [b"creator_lp", mint.key().as_ref(), creator.key().as_ref()],
        bump,
    )]
    pub creator_lp_account: Account<'info, TokenAccount>,

    /// FeeRouter's FeeConfig PDA. Stored in pool for future CPI use.
    /// CHECK: Validated in Phase 3 when FeeRouter CPI is integrated.
    pub fee_config: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct EnableTrading<'info> {
    #[account(
        mut,
        seeds = [b"pool", pool.mint.as_ref()],
        bump = pool.bump,
    )]
    pub pool: Account<'info, Pool>,
}

#[derive(Accounts)]
pub struct Swap<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"pool", pool.mint.as_ref()],
        bump = pool.bump,
    )]
    pub pool: Account<'info, Pool>,

    /// Pool's token vault.
    #[account(
        mut,
        seeds = [b"token_vault", pool.mint.as_ref()],
        bump,
    )]
    pub token_vault: Account<'info, TokenAccount>,

    /// Pool's SOL vault.
    /// CHECK: PDA used as lamport holder.
    #[account(
        mut,
        seeds = [b"sol_vault", pool.mint.as_ref()],
        bump,
    )]
    pub sol_vault: SystemAccount<'info>,

    /// User's token account for the pool's token.
    #[account(
        mut,
        constraint = user_token_account.mint == pool.mint,
        constraint = user_token_account.owner == user.key(),
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AddLiquidity<'info> {
    #[account(mut)]
    pub provider: Signer<'info>,

    #[account(
        mut,
        seeds = [b"pool", pool.mint.as_ref()],
        bump = pool.bump,
    )]
    pub pool: Account<'info, Pool>,

    #[account(
        mut,
        address = pool.lp_mint,
    )]
    pub lp_mint: Account<'info, Mint>,

    #[account(
        mut,
        seeds = [b"token_vault", pool.mint.as_ref()],
        bump,
    )]
    pub token_vault: Account<'info, TokenAccount>,

    /// CHECK: PDA used as lamport holder.
    #[account(
        mut,
        seeds = [b"sol_vault", pool.mint.as_ref()],
        bump,
    )]
    pub sol_vault: SystemAccount<'info>,

    #[account(
        mut,
        constraint = provider_token_account.mint == pool.mint,
        constraint = provider_token_account.owner == provider.key(),
    )]
    pub provider_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = provider_lp_account.mint == pool.lp_mint,
        constraint = provider_lp_account.owner == provider.key(),
    )]
    pub provider_lp_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RemoveLiquidity<'info> {
    #[account(mut)]
    pub provider: Signer<'info>,

    #[account(
        mut,
        seeds = [b"pool", pool.mint.as_ref()],
        bump = pool.bump,
    )]
    pub pool: Account<'info, Pool>,

    #[account(
        mut,
        address = pool.lp_mint,
    )]
    pub lp_mint: Account<'info, Mint>,

    #[account(
        mut,
        seeds = [b"token_vault", pool.mint.as_ref()],
        bump,
    )]
    pub token_vault: Account<'info, TokenAccount>,

    /// CHECK: PDA used as lamport holder.
    #[account(
        mut,
        seeds = [b"sol_vault", pool.mint.as_ref()],
        bump,
    )]
    pub sol_vault: SystemAccount<'info>,

    #[account(
        mut,
        constraint = provider_token_account.mint == pool.mint,
        constraint = provider_token_account.owner == provider.key(),
    )]
    pub provider_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = provider_lp_account.mint == pool.lp_mint,
        constraint = provider_lp_account.owner == provider.key(),
    )]
    pub provider_lp_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[account]
#[derive(InitSpace)]
pub struct Pool {
    /// The token mint this pool trades against SOL.
    pub mint: Pubkey,           // 32
    /// Current token reserve in the pool.
    pub token_reserve: u64,     // 8
    /// Current SOL reserve in the pool (lamports).
    pub sol_reserve: u64,       // 8
    /// Total LP token supply.
    pub lp_supply: u64,         // 8
    /// Mint address for LP tokens.
    pub lp_mint: Pubkey,        // 32
    /// FeeRouter's FeeConfig PDA address.
    pub fee_config: Pubkey,     // 32
    /// Whether trading is currently enabled.
    pub trading_enabled: bool,  // 1
    /// Unix timestamp when the pool was created.
    pub created_at: i64,        // 8
    /// The creator/authority of the pool.
    pub creator: Pubkey,        // 32
    /// PDA bump seed.
    pub bump: u8,               // 1
}
// Total: 32 + 8 + 8 + 8 + 32 + 32 + 1 + 8 + 32 + 1 = 162

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[error_code]
pub enum AmmError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Insufficient liquidity in pool")]
    InsufficientLiquidity,
    #[msg("Trading is not yet enabled for this pool")]
    TradingNotEnabled,
    #[msg("Trading is already enabled")]
    TradingAlreadyEnabled,
    #[msg("Trading cooldown period has not elapsed")]
    TradingCooldownActive,
    #[msg("Slippage tolerance exceeded")]
    SlippageExceeded,
    #[msg("Insufficient output amount")]
    InsufficientOutput,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Integer square root using Newton's method (for u128).
fn integer_sqrt(n: u128) -> u128 {
    if n == 0 {
        return 0;
    }
    let mut x = n;
    let mut y = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    x
}
