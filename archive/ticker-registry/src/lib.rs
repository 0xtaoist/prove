use anchor_lang::prelude::*;
use anchor_spl::token::Mint;

declare_id!("Tick111111111111111111111111111111111111111");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_TICKER_LEN: usize = 10;
const DEFAULT_TTL_SECONDS: i64 = 604_800; // 7 days

// ---------------------------------------------------------------------------
// Program
// ---------------------------------------------------------------------------

#[program]
pub mod ticker_registry {
    use super::*;

    /// One-time global setup. Stores the protocol authority and TTL config.
    pub fn initialize_registry(ctx: Context<InitializeRegistry>) -> Result<()> {
        let config = &mut ctx.accounts.registry_config;
        config.authority = ctx.accounts.authority.key();
        config.max_ticker_length = MAX_TICKER_LEN as u8;
        config.ttl_seconds = DEFAULT_TTL_SECONDS;
        config.total_registered = 0;
        config.bump = ctx.bumps.registry_config;

        emit!(RegistryInitialized {
            authority: config.authority,
            ttl_seconds: config.ttl_seconds,
        });
        Ok(())
    }

    /// Register a fresh ticker. Designed to be called as a CPI from
    /// `batch_auction::create_auction` so the ticker is always tied to a
    /// real mint and a real launch attempt, but can also be called directly.
    ///
    /// `registrant` is the account whose key controls the ticker — typically
    /// the auction creator. They are recorded so they can later release the
    /// ticker themselves via `deactivate_ticker`.
    pub fn register_ticker(ctx: Context<RegisterTicker>, ticker: String) -> Result<()> {
        validate_ticker(&ticker)?;

        let clock = Clock::get()?;
        let entry = &mut ctx.accounts.ticker_entry;
        entry.ticker = ticker.clone();
        entry.mint = ctx.accounts.mint.key();
        entry.registrant = ctx.accounts.registrant.key();
        entry.registered_at = clock.unix_timestamp;
        entry.deactivated_at = 0;
        entry.active = true;
        entry.bump = ctx.bumps.ticker_entry;

        let config = &mut ctx.accounts.registry_config;
        config.total_registered = config
            .total_registered
            .checked_add(1)
            .ok_or(TickerError::MathOverflow)?;

        emit!(TickerRegistered {
            ticker,
            mint: entry.mint,
            registrant: entry.registrant,
            registered_at: entry.registered_at,
        });
        Ok(())
    }

    /// Reuse a previously deactivated ticker after the TTL has expired.
    pub fn register_ticker_reuse(
        ctx: Context<RegisterTickerReuse>,
        ticker: String,
    ) -> Result<()> {
        validate_ticker(&ticker)?;

        let clock = Clock::get()?;
        let config = &mut ctx.accounts.registry_config;
        let entry = &mut ctx.accounts.ticker_entry;

        require!(!entry.active, TickerError::TickerAlreadyActive);

        let expiry = entry
            .deactivated_at
            .checked_add(config.ttl_seconds)
            .ok_or(TickerError::MathOverflow)?;
        require!(clock.unix_timestamp > expiry, TickerError::TtlNotExpired);

        entry.ticker = ticker.clone();
        entry.mint = ctx.accounts.mint.key();
        entry.registrant = ctx.accounts.registrant.key();
        entry.registered_at = clock.unix_timestamp;
        entry.deactivated_at = 0;
        entry.active = true;

        config.total_registered = config
            .total_registered
            .checked_add(1)
            .ok_or(TickerError::MathOverflow)?;

        emit!(TickerRegistered {
            ticker,
            mint: entry.mint,
            registrant: entry.registrant,
            registered_at: entry.registered_at,
        });
        Ok(())
    }

    /// Deactivate a ticker. Either the original registrant (e.g. a creator
    /// whose auction failed) or the registry authority can call this.
    pub fn deactivate_ticker(ctx: Context<DeactivateTicker>) -> Result<()> {
        let clock = Clock::get()?;
        let entry = &mut ctx.accounts.ticker_entry;

        require!(entry.active, TickerError::TickerAlreadyInactive);

        let signer = ctx.accounts.signer.key();
        let is_registrant = signer == entry.registrant;
        let is_authority = signer == ctx.accounts.registry_config.authority;
        require!(is_registrant || is_authority, TickerError::Unauthorized);

        entry.active = false;
        entry.deactivated_at = clock.unix_timestamp;

        emit!(TickerDeactivated {
            ticker: entry.ticker.clone(),
            mint: entry.mint,
            deactivated_at: entry.deactivated_at,
            by_authority: is_authority,
        });
        Ok(())
    }

    /// Admin-only: rotate the registry authority via two-step transfer.
    pub fn propose_authority(
        ctx: Context<AdminOnly>,
        new_authority: Pubkey,
    ) -> Result<()> {
        let config = &mut ctx.accounts.registry_config;
        config.pending_authority = new_authority;
        emit!(AuthorityProposed { new_authority });
        Ok(())
    }

    /// Pending authority accepts the role.
    pub fn accept_authority(ctx: Context<AcceptAuthority>) -> Result<()> {
        let config = &mut ctx.accounts.registry_config;
        require!(
            config.pending_authority == ctx.accounts.new_authority.key(),
            TickerError::Unauthorized
        );
        let old = config.authority;
        config.authority = ctx.accounts.new_authority.key();
        config.pending_authority = Pubkey::default();
        emit!(AuthorityRotated {
            old,
            new: config.authority,
        });
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn validate_ticker(ticker: &str) -> Result<()> {
    require!(
        !ticker.is_empty() && ticker.len() <= MAX_TICKER_LEN,
        TickerError::InvalidTickerLength
    );
    require!(
        ticker
            .chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit()),
        TickerError::InvalidTickerCharacters
    );
    Ok(())
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

    /// The token mint this ticker is being claimed for. Validated as a real
    /// SPL Mint so junk pubkeys can't squat the namespace.
    pub mint: Account<'info, Mint>,

    /// CHECK: The wallet that controls this ticker entry (typically the
    /// auction creator). They will be allowed to deactivate it later.
    pub registrant: UncheckedAccount<'info>,

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

    pub mint: Account<'info, Mint>,

    /// CHECK: New registrant for the reused ticker.
    pub registrant: UncheckedAccount<'info>,

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

    #[account(
        seeds = [b"registry_config"],
        bump = registry_config.bump,
    )]
    pub registry_config: Account<'info, RegistryConfig>,

    /// Either the original registrant or the registry authority.
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    #[account(
        mut,
        seeds = [b"registry_config"],
        bump = registry_config.bump,
        constraint = registry_config.authority == authority.key() @ TickerError::Unauthorized,
    )]
    pub registry_config: Account<'info, RegistryConfig>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct AcceptAuthority<'info> {
    #[account(
        mut,
        seeds = [b"registry_config"],
        bump = registry_config.bump,
    )]
    pub registry_config: Account<'info, RegistryConfig>,

    pub new_authority: Signer<'info>,
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[account]
pub struct RegistryConfig {
    /// Protocol admin.
    pub authority: Pubkey,
    /// Pending authority for two-step transfer (default = Pubkey::default()).
    pub pending_authority: Pubkey,
    /// Maximum allowed ticker length.
    pub max_ticker_length: u8,
    /// Seconds before a deactivated ticker can be reused.
    pub ttl_seconds: i64,
    /// Total tickers ever registered.
    pub total_registered: u64,
    /// PDA bump.
    pub bump: u8,
}

impl RegistryConfig {
    // discriminator(8) + 32 + 32 + 1 + 8 + 8 + 1
    pub const SPACE: usize = 8 + 32 + 32 + 1 + 8 + 8 + 1;
}

#[account]
pub struct TickerEntry {
    /// Ticker symbol, uppercase, max 10 chars.
    pub ticker: String,
    /// Associated token mint.
    pub mint: Pubkey,
    /// Wallet that controls this ticker entry (registrant / creator).
    pub registrant: Pubkey,
    /// Unix timestamp of registration.
    pub registered_at: i64,
    /// Unix timestamp of deactivation (0 if active).
    pub deactivated_at: i64,
    /// Whether the ticker is currently active.
    pub active: bool,
    /// PDA bump.
    pub bump: u8,
}

impl TickerEntry {
    // discriminator(8) + string prefix(4) + max chars(10) + 32 + 32 + 8 + 8 + 1 + 1
    pub const SPACE: usize = 8 + (4 + MAX_TICKER_LEN) + 32 + 32 + 8 + 8 + 1 + 1;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[event]
pub struct RegistryInitialized {
    pub authority: Pubkey,
    pub ttl_seconds: i64,
}

#[event]
pub struct TickerRegistered {
    pub ticker: String,
    pub mint: Pubkey,
    pub registrant: Pubkey,
    pub registered_at: i64,
}

#[event]
pub struct TickerDeactivated {
    pub ticker: String,
    pub mint: Pubkey,
    pub deactivated_at: i64,
    pub by_authority: bool,
}

#[event]
pub struct AuthorityProposed {
    pub new_authority: Pubkey,
}

#[event]
pub struct AuthorityRotated {
    pub old: Pubkey,
    pub new: Pubkey,
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

    #[msg("Unauthorized")]
    Unauthorized,
}
