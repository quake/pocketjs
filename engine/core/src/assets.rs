//! Atomic installation of a group of baked UI assets.
//!
//! All parsing and texture allocation happens in a staging core. The live
//! core is only changed after its texture slot storage has been reserved.
//! Invalid input and recoverable reservation failures leave it untouched.
//! Ordinary Rust allocator exhaustion follows the host's fatal OOM policy.

use crate::{rd_u16, spec, style, tex_alloc, text, Ui};
use alloc::vec;
use core::mem;

#[derive(Clone, Copy)]
pub enum AssetKind {
    Styles,
    Font,
    Image,
    Sprite,
}

pub struct AssetInput<'a> {
    pub kind: AssetKind,
    pub bytes: &'a [u8],
}

#[derive(Debug, PartialEq, Eq)]
pub enum AssetError {
    Invalid,
    NoMemory,
}

impl Ui {
    /// Install all assets, or none. Texture handles are returned at the
    /// corresponding input index; styles and fonts return -1. Neither the
    /// core nor `handles` is modified on an error.
    pub fn load_assets(
        &mut self,
        inputs: &[AssetInput<'_>],
        handles: &mut [i32],
    ) -> Result<(), AssetError> {
        if handles.len() != inputs.len() {
            return Err(AssetError::Invalid);
        }
        if inputs.is_empty() {
            return Ok(());
        }
        let original_styles = mem::replace(&mut self.styles, style::StyleTable::new());
        let mut original_fonts = mem::replace(&mut self.fonts, text::Fonts::new());
        let mut original_textures = mem::replace(&mut self.textures, Vec::new());
        let original_tex_free = mem::replace(&mut self.tex_free, Vec::new());
        let original_revision = self.raster_revision;
        let original_dirty = self.layout.dirty;
        let mut staged_handles = vec![-1; inputs.len()];
        let mut styles = false;
        let mut fonts = [false; spec::MAX_FONT_SLOTS];
        let result = (|| {
            for (index, input) in inputs.iter().enumerate() {
                let b = input.bytes;
                match input.kind {
                    AssetKind::Styles => {
                        if styles || !self.load_styles(b) {
                            return Err(AssetError::Invalid);
                        }
                        styles = true;
                    }
                    AssetKind::Font => {
                        let slot = *b.get(12).ok_or(AssetError::Invalid)? as usize;
                        if slot >= fonts.len() || fonts[slot] || !self.load_font_atlas(b) {
                            return Err(AssetError::Invalid);
                        }
                        fonts[slot] = true;
                    }
                    AssetKind::Image => {
                        let handle = self.upload_img_entry(b);
                        if handle < 0 {
                            return Err(AssetError::Invalid);
                        }
                        staged_handles[index] = handle;
                    }
                    AssetKind::Sprite => {
                        if b.len() < 16 || b[5] != 0 {
                            return Err(AssetError::Invalid);
                        }
                        let w = rd_u16(b, 0).ok_or(AssetError::Invalid)? as u32;
                        let h = rd_u16(b, 2).ok_or(AssetError::Invalid)? as u32;
                        let frames = rd_u16(b, 6).ok_or(AssetError::Invalid)? as u32;
                        let cols = rd_u16(b, 8).ok_or(AssetError::Invalid)? as u32;
                        let step = rd_u16(b, 10).ok_or(AssetError::Invalid)?;
                        if frames == 0
                            || cols == 0
                            || step == 0
                            || w % cols != 0
                            || h % frames.div_ceil(cols) != 0
                        {
                            return Err(AssetError::Invalid);
                        }
                        let handle = self.upload_texture(&b[16..], w, h, b[4] as u32);
                        if handle < 0 {
                            return Err(AssetError::Invalid);
                        }
                        staged_handles[index] = handle;
                    }
                }
            }
            let additional = self.textures.len().saturating_sub(original_tex_free.len());
            if original_textures.len().saturating_add(additional) > spec::TEX_SLOT_MASK as usize + 1
            {
                return Err(AssetError::NoMemory);
            }
            original_textures
                .try_reserve(additional)
                .map_err(|_| AssetError::NoMemory)
        })();
        if result.is_err() {
            self.styles = original_styles;
            self.fonts = original_fonts;
            self.textures = original_textures;
            self.tex_free = original_tex_free;
            self.raster_revision = original_revision;
            self.layout.dirty = original_dirty;
            return result;
        }

        // No fallible operation or allocation is allowed below this point.
        let staged_styles = mem::replace(&mut self.styles, original_styles);
        if styles {
            self.styles = staged_styles;
        } else {
            drop(staged_styles);
        }
        original_fonts.merge_atlases(&mut self.fonts);
        self.fonts = original_fonts;
        let mut staged_textures = mem::replace(&mut self.textures, original_textures);
        let staged_tex_free = mem::replace(&mut self.tex_free, original_tex_free);
        drop(staged_tex_free);
        for handle in &mut staged_handles {
            if *handle >= 0 {
                let texture = staged_textures[*handle as usize].tex.take().unwrap();
                *handle = tex_alloc(&mut self.textures, &mut self.tex_free, texture);
            }
        }
        drop(staged_textures);
        handles.copy_from_slice(&staged_handles);
        self.layout.dirty = true;
        self.bump_raster_revision();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_late_invalid_entry_preserves_resources_handles_and_revision() {
        let mut core = Ui::new();
        let existing = core.upload_texture(&[11, 22, 33, 255], 1, 1, spec::psm::PSM_8888);
        let revision = core.raster_revision();
        let image = [1, 0, 1, 0, 3, 0, 0, 0, 44, 55, 66, 255];
        let inputs = [
            AssetInput {
                kind: AssetKind::Image,
                bytes: &image,
            },
            AssetInput {
                kind: AssetKind::Font,
                bytes: b"bad-font",
            },
        ];
        let mut handles = [123, 456];
        assert_eq!(
            core.load_assets(&inputs, &mut handles),
            Err(AssetError::Invalid)
        );
        assert_eq!(handles, [123, 456]);
        assert_eq!(core.raster_revision(), revision);
        assert_eq!(core.texture(existing).unwrap().pixels, &[11, 22, 33, 255]);
        assert_eq!(core.textures.len(), 1);
        core.load_assets(&inputs[..1], &mut handles[..1]).unwrap();
        assert_eq!(handles[0], existing + 1);
        assert_eq!(core.texture(handles[0]).unwrap().pixels, &image[8..]);
    }
}
