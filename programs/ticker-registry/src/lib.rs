use anchor_lang::prelude::*;

declare_id!("Tick111111111111111111111111111111111111111");

#[program]
pub mod ticker_registry {
    use super::*;

    pub fn initialize_registry(ctx: Context<InitializeRegistry>) -> Result<()> {
        let config = &mut ctx.accounts.registry_config;
        config.authority = ctx.accounts.authority.key();
        config.max_ticker_length = 10;
        config.ttl_seconds = 604_800; // 7 days
        config.total_registered = 0;
        config.bump = ctx.bumps.registry_config;
        Ok(())
    }

    pub fn register_ticker(ctx: Context<RegisterTicker>, ticker: String, mint: Pubkey) -> Result<()> {
        // Validate ticker format
        require!(
            !ticker.is_empty() && ticker.len() <= 10,
            TickerError::InvalidTickerLength
        );
        require!(
            ticker.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit()),
            TickerError::InvalidTickerCharacters
        );

        let clock = Clock::get()?;
        let config = &mut ctx.accounts.registry_config;

        // If a previous entry exists, verify it's reusable (deactivated + TTL expired).
        // The account constraint `init` will fail if the PDA already exists, so reuse
        // is handled by requiring the old entry to be closed first via `register_ticker_reuse`.
        // For fresh tickers, we just create the entry.

        let entry = &mut ctx.accounts.ticker_entry;
        entry.ticker = ticker;
        entry.mint = mint;
        entry.registered_at = clock.unix_timestamp;
        entry.deactivated_at = 0;
        entry.active = true;
        entry.bump = ctx.bumps.ticker_entry;

        config.total_registered = config
            .total_registered
            .checked_add(1)
            .ok_or(TickerError::MathOverflow)?;

        Ok(())
    }

    pub fn register_ticker_reuse(
        ctx: Context<RegisterTickerReuse>,
        ticker: String,
        mint: Pubkey,
    ) -> Result<()> {
        // Validate ticker format
        require!(
            !ticker.is_empty() && ticker.len() <= 10,
            TickerError::InvalidTickerLength
        );
        require!(
            ticker.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit()),
            TickerError::InvalidTickerCharacters
        );

        let clock = Clock::get()?;
        let config = &mut ctx.accounts.registry_config;
        let entry = &mut ctx.accounts.ticker_entry;

        // Must be deactivated
        require!(!entry.active, TickerError::TickerAlreadyActive);

        // TTL must have expired
        let expiry = entry
            .deactivated_at
            .checked_add(config.ttl_seconds)
            .ok_or(TickerError::MathOverflow)?;
        require!(
            clock.unix_timestamp > expiry,
            TickerError::TtlNotExpired
        );

        // Overwrite with new registration
        entry.ticker = ticker;
        entry.mint = mint;
        entry.registered_at = clock.unix_timestamp;
        entry.deactivated_at = 0;
        entry.active = true;

        config.total_registered = config
            .total_registered
            .checked_add(1)
            .ok_or(TickerError::MathOverflow)?;

        Ok(())
    }

    pub fn deactivate_ticker(ctx: Context<DeactivateTicker>) -> Result<()> {
        let clock = Clock::get()?;
        let entry = &mut ctx.accounts.ticker_entry;

        require!(entry.active, TickerError::TickerAlreadyInactive);

        entry.active = false;
        entry.deactivated_at = clock.unix_timestamp;

        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct InitializeRegistry<'info> {
    #[account(
        init,
        payer = authority,
        space = RegistryConfig::SPACE,
        seeds = [b"registry_config"],
        bump,
    )]
    pub registry_config: Account<'info, RegistryConfig>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(ticker: String)]
pub struct RegisterTicker<'info> {
    #[account(
        init,
        payer = payer,
        space = TickerEntry::SPACE,
        seeds = [b"ticker", ticker.as_bytes()],
        bump,
    )]
    pub ticker_entry: Account<'info, TickerEntry>,

    #[account(
        mut,
        seeds = [b"registry_config"],
        bump = registry_config.bump,
    )]
    pub registry_config: Account<'info, RegistryConfig>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(ticker: String)]
pub struct RegisterTickerReuse<'info> {
    #[account(
        mut,
        seeds = [b"ticker", ticker.as_bytes()],
        bump = ticker_entry.bump,
    )]
    pub ticker_entry: Account<'info, TickerEntry>,

    #[account(
        mut,
        seeds = [b"registry_config"],
        bump = registry_config.bump,
    )]
    pub registry_config: Account<'info, RegistryConfig>,

    #[account(mut)]
    pub payer: Signer<'info>,
}

#[derive(Accounts)]
pub struct DeactivateTicker<'info> {
    #[account(
        mut,
        seeds = [b"ticker", ticker_entry.ticker.as_bytes()],
        bump = ticker_entry.bump,
    )]
    pub ticker_entry: Account<'info, TickerEntry>,

    /// Only the registry authority can deactivate tickers.
    #[account(
        constraint = authority.key() == registry_config.authority @ TickerError::Unauthorized,
    )]
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"registry_config"],
        bump = registry_config.bump,
    )]
    pub registry_config: Account<'info, RegistryConfig>,
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[account]
pub struct RegistryConfig {
    /// Protocol admin
    pub authority: Pubkey,       // 32
    /// Maximum allowed ticker length
    pub max_ticker_length: u8,   // 1
    /// Seconds before a deactivated ticker can be reused
    pub ttl_seconds: i64,        // 8
    /// Total tickers ever registered
    pub total_registered: u64,   // 8
    /// PDA bump
    pub bump: u8,                // 1
}

impl RegistryConfig {
    // discriminator (8) + 32 + 1 + 8 + 8 + 1 = 58
    pub const SPACE: usize = 8 + 32 + 1 + 8 + 8 + 1;
}

#[account]
pub struct TickerEntry {
    /// Ticker symbol, uppercase, max 10 chars
    pub ticker: String,          // 4 + 10 = 14
    /// Associated token mint
    pub mint: Pubkey,            // 32
    /// Unix timestamp of registration
    pub registered_at: i64,      // 8
    /// Unix timestamp of deactivation (0 if active)
    pub deactivated_at: i64,     // 8
    /// Whether the ticker is currently active
    pub active: bool,            // 1
    /// PDA bump
    pub bump: u8,                // 1
}

impl TickerEntry {
    // discriminator (8) + string prefix (4) + max chars (10) + 32 + 8 + 8 + 1 + 1 = 72
    pub const SPACE: usize = 8 + (4 + 10) + 32 + 8 + 8 + 1 + 1;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[error_code]
pub enum TickerError {
    #[msg("Ticker must be between 1 and 10 characters")]
    InvalidTickerLength,

    #[msg("Ticker must contain only uppercase A-Z and digits 0-9")]
    InvalidTickerCharacters,

    #[msg("Ticker is already active and cannot be re-registered")]
    TickerAlreadyActive,

    #[msg("Ticker TTL has not expired yet")]
    TtlNotExpired,

    #[msg("Ticker is already inactive")]
    TickerAlreadyInactive,

    #[msg("Arithmetic overflow")]
    MathOverflow,

    #[msg("Signer is not the registry authority")]
    Unauthorized,
}
