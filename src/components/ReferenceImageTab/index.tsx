import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { X, Search, Upload, Loader2, Sparkles, ImagePlus, CheckCircle2 } from 'lucide-react';

import { cn } from '~/lib/utils';
import { Button } from '~/components/ui/button';
import { useToast } from '~/usecase/hooks/useToast';
import { CheckerBoard } from '~/components/CheckerBoard';
import { SpriteCanvas } from '~/components/commons/SpriteCanvas';
import { useAssetData } from '~/usecase/context/AssetDataContext';
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover';
import { ThingCategory, isValidSpriteId, TIBIA_FORMAT_CONFIG, toDisplayId } from '~/lib/formats/tibia';
import { Select, SelectItem, SelectValue, SelectContent, SelectTrigger } from '~/components/ui/select';
import {
	type ImageMatchResult,
	encodeFindByImagePayload,
	decodeFindByImageResponse,
	extractReferenceTilesFromBlob,
	extractReferenceTilesFromPath
} from '~/usecase/util/imageSearchUtils';

const isImagePath = (p: string) => /\.(png|bmp|jpg|jpeg)$/i.test(p);

export const ReferenceImageTab = () => {
	const { data, spriteSize, formatConfig, notifySpritesLoaded } = useAssetData();
	const { toast } = useToast();

	const [openPopover, setOpenPopover] = React.useState(false);
	const [selectedCategory, setSelectedCategory] = React.useState<'all' | ThingCategory>('all');
	const [previewUrl, setPreviewUrl] = React.useState<null | string>(null);
	const [imageSize, setImageSize] = React.useState<{ width: number; height: number } | null>(null);
	const [tiles, setTiles] = React.useState<Uint8Array[]>([]);
	const [isSearching, setIsSearching] = React.useState(false);
	const [isDragOver, setIsDragOver] = React.useState(false);
	const [matches, setMatches] = React.useState<ImageMatchResult[]>([]);
	const [selectedMatchIdx, setSelectedMatchIdx] = React.useState<number>(0);

	const dropZoneRef = React.useRef<HTMLDivElement>(null);
	const isDraggingImageRef = React.useRef(false);

	const navigateToMatch = React.useCallback(async (match: ImageMatchResult, index?: number) => {
		if (index !== undefined) {
			setSelectedMatchIdx(index);
		}
		const { emit } = await import('@tauri-apps/api/event');
		await emit('select_thing', {
			id: match.id,
			category: match.category,
			spriteId: match.bestSpriteId
		});
	}, []);

	const executeSearch = React.useCallback(
		async (searchTiles: Uint8Array[], categoryToSearch: 'all' | ThingCategory) => {
			if (!data || !data.datPath || !data.sprPath) {
				toast({
					variant: 'destructive',
					title: 'Nenhum projeto aberto',
					description: 'Abra os arquivos Tibia.dat e Tibia.spr antes de buscar.'
				});
				return;
			}
			if (searchTiles.length === 0) {
				toast({
					variant: 'destructive',
					title: 'Imagem vazia',
					description: 'A imagem de referência não possui pixels visíveis.'
				});
				return;
			}

			setIsSearching(true);
			try {
				const payload = encodeFindByImagePayload(
					searchTiles,
					categoryToSearch,
					data.transparency,
					25,
					12,
					data.datPath,
					data.sprPath
				);
				const response: any = await invoke('find_by_image_bin', payload);
				const bytes =
					response instanceof Uint8Array
						? response
						: Array.isArray(response)
							? new Uint8Array(response)
							: response && response.buffer instanceof ArrayBuffer
								? new Uint8Array(response.buffer, response.byteOffset ?? 0, response.byteLength ?? response.buffer.byteLength)
								: new Uint8Array(response);

				const results = decodeFindByImageResponse(bytes, spriteSize);

				if (results.length > 0) {
					setMatches(results);
					setSelectedMatchIdx(0);
					const best = results[0];
					await navigateToMatch(best, 0);

					const { loadSprites } = await import('~/lib/formats/sprites');
					const idsToLoad: number[] = [];
					for (const r of results.slice(0, 8)) {
						if (isValidSpriteId(r.bestSpriteId)) idsToLoad.push(r.bestSpriteId);
						for (const sid of r.thing.spriteIndex ?? []) {
							if (isValidSpriteId(sid)) idsToLoad.push(sid);
						}
					}
					if (idsToLoad.length > 0) {
						await loadSprites(data, idsToLoad);
						notifySpritesLoaded();
					}

					const catLabel =
						(data ? formatConfig.categories : TIBIA_FORMAT_CONFIG.categories).find((c) => c.id === best.category)?.label ??
						best.category;
					const displayId = toDisplayId(formatConfig, best.category, best.id);
					toast({
						title: `Sprite encontrada (${best.score}% match)`,
						description: `${catLabel} #${displayId} • Sprite #${best.bestSpriteId}`
					});
				} else {
					setMatches([]);
					toast({
						variant: 'destructive',
						title: 'Nenhuma sprite correspondente encontrada',
						description: 'Tente mudar a categoria para "Tudo (All)" ou usar outra imagem.'
					});
				}
			} catch (err) {
				console.error('Image reference search failed:', err);
				toast({
					variant: 'destructive',
					title: 'Erro ao buscar imagem',
					description: err instanceof Error ? err.message : String(err)
				});
			} finally {
				setIsSearching(false);
			}
		},
		[data, spriteSize, formatConfig, navigateToMatch, notifySpritesLoaded, toast]
	);

	const handleLoadedImage = React.useCallback(
		(extracted: { width: number; height: number; dataUrl: string; tiles: Uint8Array[] }) => {
			setPreviewUrl(extracted.dataUrl);
			setImageSize({ width: extracted.width, height: extracted.height });
			setTiles(extracted.tiles);
			setMatches([]);
		},
		[]
	);

	const handlePickFile = async () => {
		try {
			const selected = await open({
				multiple: false,
				filters: [{ name: 'Image', extensions: ['png', 'bmp', 'jpg', 'jpeg'] }]
			});
			if (!selected || typeof selected !== 'string') return;
			const extracted = await extractReferenceTilesFromPath(selected);
			await handleLoadedImage(extracted);
		} catch (err) {
			console.error('Failed to pick reference image:', err);
			toast({
				variant: 'destructive',
				title: 'Falha ao carregar imagem',
				description: err instanceof Error ? err.message : String(err)
			});
		}
	};

	const handleHtmlDrop = async (e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		setIsDragOver(false);
		const file = e.dataTransfer.files?.[0];
		if (file && isImagePath(file.name)) {
			try {
				const extracted = await extractReferenceTilesFromBlob(file);
				await handleLoadedImage(extracted);
			} catch (err) {
				console.error('Failed to load dropped image:', err);
			}
		}
	};

	React.useEffect(() => {
		if (!openPopover) return;
		const el = dropZoneRef.current;
		if (!el) return;

		const overDropZone = (x: number, y: number) => {
			const r = el.getBoundingClientRect();
			const dpr = window.devicePixelRatio || 1;
			const cx = x / dpr;
			const cy = y / dpr;
			return (
				(cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) ||
				(x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)
			);
		};

		let unlisten: undefined | (() => void);
		let cancelled = false;

		getCurrentWebviewWindow()
			.onDragDropEvent(async (event) => {
				const p = event.payload;
				if (p.type === 'enter') {
					isDraggingImageRef.current = p.paths.some(isImagePath);
					if (!isDraggingImageRef.current) return;
					setIsDragOver(overDropZone(p.position.x, p.position.y));
				} else if (p.type === 'over') {
					if (!isDraggingImageRef.current) return;
					setIsDragOver(overDropZone(p.position.x, p.position.y));
				} else if (p.type === 'leave') {
					isDraggingImageRef.current = false;
					setIsDragOver(false);
				} else if (p.type === 'drop') {
					const wasImage = isDraggingImageRef.current;
					const onTarget = overDropZone(p.position.x, p.position.y);
					isDraggingImageRef.current = false;
					setIsDragOver(false);
					if (!wasImage || !onTarget) return;

					const imagePath = p.paths.find(isImagePath);
					if (!imagePath) return;

					try {
						const extracted = await extractReferenceTilesFromPath(imagePath);
						await handleLoadedImage(extracted);
					} catch (err) {
						console.error('Tauri file drop failed:', err);
					}
				}
			})
			.then((fn) => {
				if (cancelled) fn();
				else unlisten = fn;
			});

		return () => {
			cancelled = true;
			unlisten?.();
		};
	}, [openPopover, handleLoadedImage]);

	React.useEffect(() => {
		if (!openPopover) return;
		const onPaste = async (e: ClipboardEvent) => {
			const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'));
			if (!item) return;
			e.preventDefault();
			e.stopPropagation();
			const file = item.getAsFile();
			if (!file) return;
			try {
				const extracted = await extractReferenceTilesFromBlob(file);
				await handleLoadedImage(extracted);
			} catch (err) {
				console.error('Paste reference image failed:', err);
			}
		};
		window.addEventListener('paste', onPaste, true);
		return () => window.removeEventListener('paste', onPaste, true);
	}, [openPopover, handleLoadedImage]);

	const handleClear = (e?: React.MouseEvent) => {
		e?.stopPropagation();
		setPreviewUrl(null);
		setImageSize(null);
		setTiles([]);
		setMatches([]);
	};

	const categories = data ? formatConfig.categories : TIBIA_FORMAT_CONFIG.categories;
	const stop = (e: React.MouseEvent) => e.stopPropagation();
	const activeMatch = matches[selectedMatchIdx] ?? matches[0] ?? null;

	return (
		<Popover open={openPopover} onOpenChange={setOpenPopover}>
			<PopoverTrigger asChild>
				<button
					type="button"
					onMouseDown={stop}
					disabled={!data}
					title="Buscar sprite por imagem de referência"
					className={cn(
						'flex cursor-default select-none items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-foreground outline-none transition-colors hover:bg-accent data-[state=open]:bg-accent data-[state=open]:text-accent-foreground disabled:pointer-events-none disabled:opacity-50',
						previewUrl && 'text-primary'
					)}
				>
					<ImagePlus className="h-3.5 w-3.5" />
					<span>Buscar por Imagem</span>
				</button>
			</PopoverTrigger>
			<PopoverContent
				align="start"
				sideOffset={8}
				onMouseDown={stop}
				className="w-80 p-3 shadow-2xl border-border/80 bg-popover"
			>
				<div className="space-y-3">
					<div className="flex items-center justify-between border-b border-border/50 pb-2">
						<div className="flex items-center gap-1.5">
							<Sparkles className="h-3.5 w-3.5 text-primary" />
							<span className="text-xs font-semibold uppercase tracking-wide text-foreground">
								Busca por Imagem Referência
							</span>
						</div>
						{previewUrl && (
							<Button
								size="icon"
								variant="ghost"
								onClick={handleClear}
								title="Limpar imagem"
								className="h-5 w-5 text-muted-foreground hover:text-destructive"
							>
								<X className="h-3.5 w-3.5" />
							</Button>
						)}
					</div>

					<div>
						<label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">
							Procurar em
						</label>
						<Select
							value={selectedCategory}
							onValueChange={(value) => {
								const nextCat = value as 'all' | ThingCategory;
								setSelectedCategory(nextCat);
							}}
						>
							<SelectTrigger className="h-8 text-xs">
								<SelectValue placeholder="Tudo (All)" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">Tudo (All)</SelectItem>
								{categories.map((cat) => (
									<SelectItem key={cat.id} value={cat.id}>
										{cat.label}s
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<div>
						<label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 flex items-center justify-between">
							<span>Imagem Referência</span>
							{imageSize && (
								<span className="font-mono text-[10px] text-foreground">
									{imageSize.width}x{imageSize.height}px
								</span>
							)}
						</label>

						<div
							ref={dropZoneRef}
							data-file-drop="true"
							onDrop={handleHtmlDrop}
							onClick={() => void handlePickFile()}
							onDragLeave={() => setIsDragOver(false)}
							onDragOver={(e) => {
								e.preventDefault();
								e.stopPropagation();
								setIsDragOver(true);
							}}
							className={cn(
								'relative h-32 w-full rounded-lg border-2 border-dashed transition-all cursor-pointer flex flex-col items-center justify-center overflow-hidden p-2 select-none',
								isDragOver
									? 'border-primary bg-primary/15 scale-[0.99]'
									: 'border-border/70 hover:border-primary/60 hover:bg-secondary/40'
							)}
						>
							{previewUrl ? (
								<div className="relative w-full h-full flex flex-col items-center justify-center gap-1.5">
									<CheckerBoard className="w-20 h-20 rounded border border-border/60 flex items-center justify-center overflow-hidden p-1">
										<img
											src={previewUrl}
											alt="Referência"
											className="max-w-full max-h-full object-contain"
											style={{ imageRendering: 'pixelated' }}
										/>
									</CheckerBoard>
									<span className="text-[10px] text-muted-foreground">Clique ou arraste outra para trocar</span>
								</div>
							) : (
								<div className="flex flex-col items-center justify-center text-center px-2">
									<Upload className="h-7 w-7 text-muted-foreground mb-1.5 opacity-80" />
									<span className="text-xs font-medium text-foreground">Arraste a imagem ou clique</span>
									<span className="text-[10px] text-muted-foreground mt-0.5">
										PNG, BMP, JPG ou Ctrl+V ({tiles.length || '32x32'})
									</span>
								</div>
							)}
						</div>
					</div>

					{activeMatch && (
						<div className="space-y-1.5">
							<button
								type="button"
								onClick={() => void navigateToMatch(activeMatch, selectedMatchIdx)}
								title="Clique para ir até a sprite selecionada"
								className="w-full flex items-center justify-between gap-2 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-left hover:bg-primary/20 transition-colors"
							>
								<div className="flex items-center gap-2 min-w-0">
									<CheckerBoard className="h-8 w-8 rounded border border-border/50 flex-shrink-0 flex items-center justify-center overflow-hidden">
										<SpriteCanvas showEmpty scale={1} renderMode="list" spriteId={activeMatch.bestSpriteId} />
									</CheckerBoard>
									<div className="min-w-0">
										<div className="flex items-center gap-1">
											<CheckCircle2 className="h-3.5 w-3.5 text-primary flex-shrink-0" />
											<span className="text-xs font-semibold text-foreground truncate">
												{categories.find((c) => c.id === activeMatch.category)?.label ?? activeMatch.category} #
												{toDisplayId(formatConfig, activeMatch.category, activeMatch.id)}
											</span>
										</div>
										<div className="text-[10px] font-mono text-muted-foreground">
											Sprite #{activeMatch.bestSpriteId} • {activeMatch.score}% match
										</div>
									</div>
								</div>
								<span className="text-[10px] font-medium text-primary flex-shrink-0">Ir até lá →</span>
							</button>

							{matches.length > 1 && (
								<div>
									<span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">
										Outras correspondências próximas ({matches.length - 1})
									</span>
									<div className="grid grid-cols-6 gap-1">
										{matches.slice(0, 6).map((m, idx) => {
											const isSel = idx === selectedMatchIdx;
											const dispId = toDisplayId(formatConfig, m.category, m.id);
											return (
												<button
													key={`${m.category}-${m.id}`}
													type="button"
													onClick={() => void navigateToMatch(m, idx)}
													title={`${m.category.toUpperCase()} #${dispId} (Sprite #${m.bestSpriteId}) - ${m.score}%`}
													className={cn(
														'flex flex-col items-center rounded border p-0.5 transition-all',
														isSel
															? 'border-primary bg-primary/20 ring-1 ring-primary/50'
															: 'border-border/50 bg-secondary/40 hover:border-primary/40 hover:bg-secondary'
													)}
												>
													<CheckerBoard className="h-8 w-8 rounded-sm flex items-center justify-center overflow-hidden">
														<SpriteCanvas showEmpty scale={1} renderMode="list" spriteId={m.bestSpriteId} />
													</CheckerBoard>
													<span className="text-[9px] font-mono text-muted-foreground truncate w-full text-center mt-0.5">
														{m.score}%
													</span>
												</button>
											);
										})}
									</div>
								</div>
							)}
						</div>
					)}

					<div className="flex items-center gap-2 pt-1">
						<Button
							size="sm"
							variant="outline"
							onClick={() => void handlePickFile()}
							className="h-8 text-xs flex-1 gap-1.5"
						>
							<Upload className="h-3.5 w-3.5" />
							Selecionar
						</Button>
						<Button
							size="sm"
							disabled={isSearching || tiles.length === 0 || !data}
							onClick={() => void executeSearch(tiles, selectedCategory)}
							className="h-8 text-xs flex-1 gap-1.5"
						>
							{isSearching ? (
								<>
									<Loader2 className="h-3.5 w-3.5 animate-spin" />
									Buscando...
								</>
							) : (
								<>
									<Search className="h-3.5 w-3.5" />
									Procurar
								</>
							)}
						</Button>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
};
